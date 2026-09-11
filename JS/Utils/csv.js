// Minimal CSV parsing/writing — no external dependency needed for the
// Import feature. Handles quoted fields (commas/newlines/escaped quotes).

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else field += c;
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { pushField(); }
    else if (c === '\r') { /* ignore, \n handles the line break */ }
    else if (c === '\n') { pushRow(); }
    else { field += c; }
  }
  if (field.length || row.length) pushRow();
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const records = rows.slice(1)
    .filter((r) => r.some((f) => f.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
  return { headers, records };
}

export function toCSV(columns, sampleRow) {
  const field = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => field(c.key)).join(',');
  const sample = columns.map((c) => field(sampleRow?.[c.key] ?? '')).join(',');
  return `${header}\n${sample}\n`;
}
