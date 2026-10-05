// Offline scanning rules have no browser or Supabase dependency so they can
// be exercised by the Node test runner. The RPC remains the final authority
// when queued scans are replayed.
export function classifyCachedScan(proximityCode, rows, pendingBumps = new Map()) {
  const row = rows.find((candidate) => candidate.proximity_code === proximityCode);
  if (!row) return { result: 'unmatched', employee: null, offline: true };
  if (!row.card_active) return { result: 'inactive_card', employee: null, offline: true };
  if (!row.employee_id) return { result: 'unassigned_card', employee: null, offline: true };
  if (row.employee_status !== 'active') return { result: 'inactive_employee', employee: null, offline: true };

  const bump = pendingBumps.get(row.employee_id) || 0;
  const direction = (row.scan_count + bump) % 2 === 0 ? 'in' : 'out';
  return {
    result: 'matched',
    direction,
    offline: true,
    employee: {
      full_name: row.full_name,
      employee_code: row.employee_code,
      department: row.department,
      position: row.position,
      photo_thumb_b64: row.photo_thumb_b64,
      remarks_log: row.remarks_log || [],
    },
  };
}

// Applies one get_scanner_offline_cache_delta() response to the locally
// cached lookup rows. `full` responses replace the cache outright; an
// incremental one overlays only the rows the server says changed, keyed by
// proximity_code (the same key classifyCachedScan() looks rows up by).
//
// Keying on proximity_code is safe precisely because the server's digest
// covers card id, code, is_active and assignment: anything that could add,
// remove or rename a key forces `full: true` instead of arriving as a delta,
// so the incremental branch only ever has to replace rows that already
// exist. A delta row for an unknown code would still be appended rather than
// dropped — belt and braces, since silently discarding one would mean the
// kiosk classifying that card against nothing at all.
export function mergeLookupDelta(currentRows, delta) {
  if (delta?.full) return Array.isArray(delta.rows) ? delta.rows : [];
  const rows = Array.isArray(currentRows) ? currentRows : [];
  const changed = Array.isArray(delta?.rows) ? delta.rows : [];
  if (!changed.length) return rows;
  const byCode = new Map(changed.map((r) => [r.proximity_code, r]));
  const merged = rows.map((r) => byCode.get(r.proximity_code) ?? r);
  const known = new Set(rows.map((r) => r.proximity_code));
  for (const r of changed) {
    if (!known.has(r.proximity_code)) merged.push(r);
  }
  return merged;
}

export function mergePhotoUpdates(current, updates) {
  const hasSnapshot = Boolean(current?.fileIdsByEmployeeId);
  const byEmployeeId = hasSnapshot ? { ...current.byEmployeeId } : {};
  const fileIdsByEmployeeId = hasSnapshot ? { ...current.fileIdsByEmployeeId } : {};

  for (const photo of updates.photos) {
    byEmployeeId[photo.employee_id] = photo.photo_thumb_b64;
    fileIdsByEmployeeId[photo.employee_id] = photo.photo_file_id;
  }
  for (const employeeId of updates.removed) {
    delete byEmployeeId[employeeId];
    delete fileIdsByEmployeeId[employeeId];
  }
  return { byEmployeeId, fileIdsByEmployeeId };
}

// The live scan RPC deliberately omits photo_thumb_b64 (the kiosk already
// holds every thumbnail locally — see OfflineScanModel.refreshPhotoCache()),
// so the result card gets its photo from that local cache instead. Returns
// `data` untouched when there is nothing to attach, so callers can use it
// unconditionally.
export function attachCachedPhoto(data, photosByEmployeeId = {}) {
  const employee = data?.employee;
  if (!employee || employee.photo_thumb_b64 || !employee.id) return data;
  const thumb = photosByEmployeeId[employee.id];
  return thumb ? { ...data, employee: { ...employee, photo_thumb_b64: thumb } } : data;
}

// True when the employee has a photo on the server that the local cache
// either lacks entirely (new hire, first photo) or holds a different version
// of (photo replaced) — the signal to run the incremental photo sync now
// instead of waiting for the 30-minute timer. photo_file_id changes on every
// replacement, which is what makes this comparable without downloading
// anything.
export function photoNeedsRefresh(data, photoCache) {
  const employee = data?.employee;
  if (!employee?.id || !employee.photo_file_id) return false;
  const cachedFileId = photoCache?.fileIdsByEmployeeId?.[employee.id];
  const cachedThumb = photoCache?.byEmployeeId?.[employee.id];
  return !cachedThumb || cachedFileId !== employee.photo_file_id;
}

export function groupQueuedScans(entries) {
  const groups = new Map();
  for (const entry of [...entries].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at))) {
    if (!groups.has(entry.proximity_code)) groups.set(entry.proximity_code, []);
    groups.get(entry.proximity_code).push(entry);
  }
  return [...groups.values()];
}

// Replays each card's scans in order while allowing unrelated cards to make
// bounded progress concurrently. `send` returns an error-like value on
// failure; entries after the first failure are deliberately retained.
export async function flushQueuedScans({ entries, send, remove, onProgress, concurrency = 6 }) {
  const total = entries.length;
  if (!total) return { synced: 0, remaining: 0 };

  const groups = groupQueuedScans(entries);
  let synced = 0;
  let stopped = false;
  let nextGroup = 0;

  const syncEntry = async (entry) => {
    if (stopped) return false;
    try {
      const error = await send(entry);
      if (error) {
        stopped = true;
        return false;
      }
      await remove(entry.id);
      synced += 1;
      onProgress?.(synced, total);
      return true;
    } catch {
      stopped = true;
      return false;
    }
  };

  const worker = async () => {
    while (!stopped && nextGroup < groups.length) {
      const group = groups[nextGroup++];
      for (const entry of group) {
        if (!(await syncEntry(entry))) return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  return { synced, remaining: total - synced };
}
