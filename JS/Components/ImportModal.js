// Shared bulk-import dialog, built on the same Modal.js scaffold every
// other dialog uses. Both Employee Manager and Proximity Cards use this
// exact component — they only differ in which columns they require and
// what `onImport` does with each parsed row (see DirectoryPage.js and
// ProximityPage.js).
import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { parseCSV, toCSV } from '../Utils/csv.js';
import { openModal, closeModal } from './Modal.js';

/**
 * @param {{ title: string, description?: string, columns: {key:string,label:string,required?:boolean}[], sampleRow?: object, onImport: (records:object[]) => Promise<{successCount:number, errors:{line:number,message:string}[]}> }} config
 * @param {() => void} [onDone] - called once the import finishes, so the page can refresh its table.
 */
export function openImportModal({ title, description, columns, sampleRow, onImport }, onDone) {
  const required = columns.filter((c) => c.required);

  const overlay = openModal(`
    <h3>${esc(title)}</h3>
    ${description ? `<p class="sub" style="margin:-4px 0 16px;">${esc(description)}</p>` : ''}
    <div class="emp-meta" style="margin-bottom:10px;line-height:1.6;">
      Columns: ${columns.map((c) => `<span class="mono">${esc(c.label)}</span>${c.required ? '<span style="color:var(--bad)">*</span>' : ''}`).join(', ')}
      &nbsp;—&nbsp;<a href="#" id="im-template">download a template</a>
    </div>
    <div class="field"><input type="file" id="im-file" accept=".csv,text/csv" /></div>
    <div id="im-preview"></div>
    <div class="auth-error hidden" id="im-error"></div>
    <div id="im-summary"></div>
    <div class="actions">
      <button class="ghost" id="im-cancel">Cancel</button>
      <button class="primary hidden" id="im-run" disabled>Import</button>
    </div>
  `, { maxWidth: '540px' });

  let parsedRecords = null;

  $('#im-template', overlay).addEventListener('click', (e) => {
    e.preventDefault();
    const blob = new Blob([toCSV(columns, sampleRow)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $('#im-cancel', overlay).addEventListener('click', () => closeModal(overlay));

  $('#im-file', overlay).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const errEl = $('#im-error', overlay);
    const previewEl = $('#im-preview', overlay);
    const runBtn = $('#im-run', overlay);
    errEl.classList.add('hidden');
    previewEl.innerHTML = '';
    runBtn.classList.add('hidden');
    runBtn.disabled = true;
    parsedRecords = null;
    if (!file) return;

    const text = await file.text();
    const { headers, records } = parseCSV(text);
    const missing = required.filter((c) => !headers.includes(c.key));
    if (missing.length) {
      errEl.textContent = `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.map((c) => c.key).join(', ')}`;
      errEl.classList.remove('hidden');
      return;
    }
    if (!records.length) {
      errEl.textContent = 'No data rows found in that file.';
      errEl.classList.remove('hidden');
      return;
    }
    parsedRecords = records;
    previewEl.innerHTML = `<div class="emp-meta">${records.length} row${records.length === 1 ? '' : 's'} ready to import.</div>`;
    runBtn.classList.remove('hidden');
    runBtn.disabled = false;
  });

  $('#im-run', overlay).addEventListener('click', async () => {
    if (!parsedRecords) return;
    const runBtn = $('#im-run', overlay);
    runBtn.disabled = true;
    runBtn.textContent = 'Importing…';
    const rowCount = parsedRecords.length;
    const { successCount, errors } = await onImport(parsedRecords);
    parsedRecords = null;

    $('#im-file', overlay).classList.add('hidden');
    $('#im-preview', overlay).innerHTML = '';
    runBtn.classList.add('hidden');
    $('#im-cancel', overlay).textContent = 'Close';
    $('#im-summary', overlay).innerHTML = `
      <div class="emp-meta">Imported <strong style="color:var(--good)">${successCount}</strong> of ${rowCount} row${rowCount === 1 ? '' : 's'}.</div>
      ${errors.length ? `
        <div class="search-results" style="max-height:180px;margin-top:8px;">
          ${errors.map((e) => `<div class="search-result-item" style="cursor:default;"><span class="mono" style="color:var(--bad);flex-shrink:0;">Row ${e.line}</span>${esc(e.message)}</div>`).join('')}
        </div>
      ` : ''}
    `;
    onDone?.();
  });
}
