// Offline scanning rules have no browser or Supabase dependency so they can
// be exercised by the Node test runner. The RPC remains the final authority
// when queued scans are replayed.

// The length almost every issued card has — the MODE of registered code
// lengths, not the minimum.
//
// Measured 2026-10-08: 761 of 762 cards are exactly 10 digits, and the lone
// outlier is an inactive 3-character test card. Using the minimum therefore
// produced a threshold of 3, which accepted every truncated read; the mode is
// unaffected by that kind of stray row.
export function expectedCodeLength(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const len = String(row?.proximity_code ?? '').trim().length;
    if (len > 0) counts.set(len, (counts.get(len) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [len, n] of counts) {
    // Ties go to the longer length: accepting a short read is the failure mode
    // that loses a scan, so err towards demanding more digits.
    if (n > bestCount || (n === bestCount && len > best)) { best = len; bestCount = n; }
  }
  return best;
}

// The longest card ever issued. A read longer than this cannot be any card:
// a suffix is never longer than the string it is a suffix of, so an over-long
// read is not a truncation either. Measured 2026-10-08, the eight surviving
// `unknown_card_scan` alerts were 40-71 characters of one repeated digit
// against a 10-digit card — a stuck key on the reader, not a badge.
export function maxCodeLength(rows) {
  let max = 0;
  for (const row of rows || []) {
    const len = String(row?.proximity_code ?? '').trim().length;
    if (len > max) max = len;
  }
  return max;
}

// True when every registered card is digits only, which makes a letter in a
// read proof it did not come from a badge. Derived rather than hardcoded so
// issuing alphanumeric cards later relaxes this on its own.
export function codesAreNumeric(rows) {
  let seen = false;
  for (const row of rows || []) {
    const value = String(row?.proximity_code ?? '').trim();
    if (!value) continue;
    if (!/^[0-9]+$/.test(value)) return false;
    seen = true;
  }
  return seen;
}

// Why a read was discarded, or null if it should be sent. One source of truth
// for both the decision and the operator's message — "Partial read" is wrong
// for 71 characters of a held-down key.
export function readRejection(code, rows) {
  const value = String(code ?? '').trim();
  if (!value) return 'empty';
  if (!rows?.length) return null; // never synced — fail open
  // An exact hit always wins, so a legitimately odd registered card still works.
  if (rows.some((r) => String(r?.proximity_code ?? '').trim() === value)) return null;

  const max = maxCodeLength(rows);
  if (max > 0 && value.length > max) return 'long';
  if (codesAreNumeric(rows) && !/^[0-9]+$/.test(value)) return 'charset';

  const expected = expectedCodeLength(rows);
  if (expected > 0 && value.length < expected) return 'short';
  return null;
}

// Whether a scanned value is a COMPLETE card read.
//
// Badge readers are keyboard wedges that send no trailing Enter, so the kiosk
// auto-submits ~200ms after typing stops. If the input is not focused when a
// read begins, the leading digits go nowhere and the timer fires on whatever
// arrived — producing a short code that matches no card.
//
// That is not hypothetical. Measured against the live database on 2026-10-08:
// 58 of 59 distinct "unknown card" codes were SUFFIXES of registered cards —
// `037` of `0005204037`, `9295` of `0005669295`, `215056` of `0005215056`.
// Every one was a real employee whose badge silently failed and who had to scan
// again. The alerts blamed cards that do not exist.
//
// So a short read is rejected before it is sent: no failed scan, no misleading
// alert, and the operator is told to scan again. Two escape hatches keep that
// from being over-strict:
//   * an EXACT match against a known code is always accepted, so a legitimately
//     short card (there is one 3-character test card) still works;
//   * an unknown roster fails OPEN, because a kiosk that has never synced must
//     not silently swallow scans.
//
// The remaining tradeoff: an UNREGISTERED card shorter than the usual length is
// now rejected rather than alerted. Given 98% of short reads are truncations of
// real cards, that is the right way round.
//
// Added 2026-10-08: the same applies at the other end. A read longer than the
// longest issued card, or carrying characters no card uses, is discarded too.
// Unlike the short case this cannot hide a truncation, because a truncation is
// a suffix and a suffix is never longer than its card. See readRejection().
export function looksLikeCardCode(code, rows) {
  return readRejection(code, rows) === null;
}
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
