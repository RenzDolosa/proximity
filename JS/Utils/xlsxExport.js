// Builds and downloads an .xlsx file using the vendored SheetJS mini
// build (window.XLSX — see Public/Vendor/README.md for why the mini
// build over the full one, and how to upgrade it). Every "Export .xlsx"
// button in the app (Employee Manager, Proximity Cards, Scan Log) goes
// through this one function, so "force certain columns to real text
// instead of a number Excel silently reformats" lives in exactly one
// place rather than being reimplemented per page.
//
// columns: [{ key, label, text?: boolean }]. `text: true` marks a column
// whose values must round-trip through Excel exactly as typed — proximity
// codes and employee codes, specifically, which can be all-digit strings
// (e.g. "00091") that Excel will otherwise happily reinterpret as a
// number the moment a user so much as clicks into the cell, silently
// dropping the leading zero (or, for a longer numeric-looking code,
// mangling it into scientific notation). Two things are set, and both
// matter: cell.t = 's' stops SheetJS itself from ever writing a numeric
// cell type for that value; cell.z = '@' (Excel's "Text" number format)
// is what actually stops EXCEL from re-interpreting an all-digit string
// the next time the file is opened or the cell is edited — t: 's' alone
// isn't enough to survive that round-trip.
// rows: plain objects; only `key` is read off each one.
export function exportXlsx({ filename, sheetName = 'Sheet1', columns, rows }) {
  const XLSX = window.XLSX;
  if (!XLSX) {
    throw new Error("Export isn't available right now — the spreadsheet library failed to load. Try reloading the page.");
  }

  const header = columns.map((c) => c.label);
  const body = rows.map((row) => columns.map((c) => row[c.key] ?? ''));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  columns.forEach((col, colIdx) => {
    if (!col.text) return;
    for (let r = 1; r <= rows.length; r++) { // r=0 is the header row — left alone
      const cell = ws[XLSX.utils.encode_cell({ r, c: colIdx })];
      if (!cell) continue; // a blank value for this row/column — nothing to force
      cell.t = 's';
      cell.z = '@';
    }
  });

  // Reasonable column widths so the file doesn't open with every column
  // squeezed to Excel's default ~9-character width — sized off the
  // longer of the header label or the widest value actually in that
  // column, clamped so one long outlier (an email, a remark) can't blow
  // the sheet out sideways.
  ws['!cols'] = columns.map((c, colIdx) => ({
    wch: Math.min(Math.max(c.label.length, ...body.map((r) => String(r[colIdx] ?? '').length)) + 2, 40),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename); // triggers the browser's own download — no manual Blob/anchor plumbing needed
}

// yyyy-mm-dd, local time — used to timestamp every export filename
// (e.g. employees-2026-09-19.xlsx) so a re-export doesn't silently
// overwrite an earlier one in the browser's downloads folder.
export const todayStamp = () => new Date().toLocaleDateString('en-CA');
