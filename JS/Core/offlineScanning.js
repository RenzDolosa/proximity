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
