// Pure formatting helpers — no DOM, no state, safe to reuse anywhere.

export const esc = (s) =>
  (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const initials = (name) =>
  (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

// Splits an array into fixed-size chunks — used to batch bulk inserts
// (e.g. CSV import) into a handful of round-trips instead of one per row.
export const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
