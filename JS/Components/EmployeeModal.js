import { $, $$ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError, startModalOpen, isStaleModalOpen } from './Modal.js';
import { appState } from '../Core/state.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../Models/ProximityCardsModel.js';

// Opens instantly — the two network calls this needs (unassigned cards +
// who's linked to what) load in the background *after* the modal is
// already on screen, instead of blocking openModal() itself. It used to
// await both before rendering anything, so clicking Edit did nothing
// visible for a beat and then the whole modal popped in at once. The
// employee's own current code (`emp.active_proximity_code`) is already in
// memory from the table row, so that part never needed the fetch at all —
// only the "pick a different existing card" search list does.
export async function openEmployeeModal(emp, onSaved) {
  const isEdit = !!emp;
  const token = startModalOpen();
  let availableCards = [];

  const overlay = openModal(`
    <h3>${isEdit ? 'Edit employee' : 'Add employee'}</h3>
    <div class="grid-2">
      <div class="field"><label>Full name</label><input id="f-name" value="${esc(emp?.full_name || '')}" /></div>
      <div class="field"><label>Employee code</label><input id="f-code" value="${esc(emp?.employee_code || '')}" /></div>
      <div class="field"><label>Department</label><input id="f-dept" value="${esc(emp?.department || '')}" /></div>
      <div class="field"><label>Position</label><input id="f-pos" value="${esc(emp?.position || '')}" /></div>
      <div class="field"><label>Email</label><input id="f-email" value="${esc(emp?.email || '')}" /></div>
      <div class="field"><label>Phone</label><input id="f-phone" value="${esc(emp?.phone || '')}" /></div>
    </div>
    <div class="field"><label>Status</label>
      <select id="f-status">
        ${['active', 'inactive', 'suspended'].map((s) => `<option value="${s}" ${emp?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Proximity code <span style="color:var(--text-faint)">(required — every employee needs one)</span></label>
      <select id="f-card-mode">
        <option value="existing">${isEdit ? 'Assign a different card' : 'Assign an existing unassigned card'}</option>
        <option value="new">Issue a brand-new proximity code</option>
      </select>
    </div>
    <div class="field" id="f-card-existing-wrap">
      ${isEdit && emp?.active_proximity_code ? `<div class="emp-meta" style="margin-bottom:6px;">Currently assigned: <span class="mono">${esc(emp.active_proximity_code)}</span></div>` : ''}
      <input id="f-card-search" class="mono" placeholder="Loading proximity cards…" autocomplete="off" autofocus disabled />
      <div id="f-card-results" class="search-results hidden"></div>
    </div>
    <div class="field hidden" id="f-card-new-wrap">
      <input id="f-card-new" class="mono" placeholder="e.g. PRX-00099" />
    </div>
    <div class="auth-error hidden" id="f-error"></div>
    <div class="actions">
      <button class="ghost" id="f-cancel">Cancel</button>
      <button class="primary" id="f-save">${isEdit ? 'Save changes' : 'Add employee'}</button>
    </div>
  `);

  $('#f-cancel', overlay).addEventListener('click', () => closeModal(overlay));
  $('#f-card-mode', overlay).addEventListener('change', (e) => {
    $('#f-card-existing-wrap', overlay).classList.toggle('hidden', e.target.value !== 'existing');
    $('#f-card-new-wrap', overlay).classList.toggle('hidden', e.target.value !== 'new');
  });

  // ---- live-search combobox for proximity card selection ----
  overlay.dataset.chosenCard = emp?.proximity_card_id || '';

  function paintCardResults(filterText) {
    const f = filterText.trim().toLowerCase();
    const resultsEl = $('#f-card-results', overlay);
    const matches = availableCards.filter((c) => !f || c.proximity_code.toLowerCase().includes(f));
    if (!matches.length) {
      resultsEl.innerHTML = `<div class="search-empty">No unassigned cards match — issue a new one instead.</div>`;
      return;
    }
    resultsEl.innerHTML = matches.map((c) => `
      <div class="search-result-item mono ${c.id === overlay.dataset.chosenCard ? 'selected' : ''}" data-card="${c.id}">
        ${esc(c.proximity_code)}
        ${c.id === emp?.proximity_card_id ? '<span class="tag-current">current</span>' : ''}
      </div>
    `).join('');
    $$('.search-result-item', resultsEl).forEach((row) => row.addEventListener('click', () => {
      overlay.dataset.chosenCard = row.dataset.card;
      paintCardResults($('#f-card-search', overlay).value);
    }));
  }
  // Results only show while the search field is actually focused — it
  // used to render open by default, listing every unassigned card even
  // before you'd interacted with it. The timeout on blur (rather than
  // hiding immediately) gives a click on a result item time to register;
  // that item is a plain non-focusable <div>, so clicking it doesn't blur
  // the input in the first place, but this stays as a safety margin.
  const cardResultsEl = $('#f-card-results', overlay);
  $('#f-card-search', overlay).addEventListener('focus', () => cardResultsEl.classList.remove('hidden'));
  $('#f-card-search', overlay).addEventListener('blur', () => {
    setTimeout(() => cardResultsEl.classList.add('hidden'), 120);
  });
  $('#f-card-search', overlay).addEventListener('input', (e) => paintCardResults(e.target.value));

  // unassigned, active cards + (when editing) the employee's own current
  // card — loads in the background, the form above is already usable
  // (including "issue a brand-new code" mode, which doesn't need this at
  // all) while it does.
  (async () => {
    const [{ data: allCards }, { data: linkedRows }] = await Promise.all([
      ProximityCardsModel.listAll(),
      EmployeesModel.listCardLinks(),
    ]);
    if (isStaleModalOpen(token)) return; // superseded by a newer click before this resolved
    const linkedIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));
    availableCards = (allCards || []).filter((c) => c.is_active && (!linkedIds.has(c.id) || c.id === emp?.proximity_card_id));

    const searchInput = $('#f-card-search', overlay);
    searchInput.disabled = false;
    searchInput.placeholder = 'Search proximity codes…';
    // Only auto-switch to "issue new" if the person hasn't already touched
    // the mode selector while this was loading.
    if (!availableCards.length && $('#f-card-mode', overlay).value === 'existing') {
      $('#f-card-mode', overlay).value = 'new';
      $('#f-card-mode', overlay).dispatchEvent(new Event('change'));
    }
    paintCardResults(searchInput.value);
  })();

  $('#f-save', overlay).addEventListener('click', async () => {
    const errSel = '#f-error';
    $(errSel, overlay).classList.add('hidden');
    const payload = {
      full_name: $('#f-name', overlay).value.trim(),
      employee_code: $('#f-code', overlay).value.trim(),
      department: $('#f-dept', overlay).value.trim() || null,
      position: $('#f-pos', overlay).value.trim() || null,
      email: $('#f-email', overlay).value.trim() || null,
      phone: $('#f-phone', overlay).value.trim() || null,
      status: $('#f-status', overlay).value,
    };
    if (!payload.full_name || !payload.employee_code) {
      showModalError(overlay, errSel, 'Full name and employee code are required.');
      return;
    }

    // resolve the proximity_card_id: reuse existing, or create a new card first
    const mode = $('#f-card-mode', overlay).value;
    if (mode === 'new') {
      const newCode = $('#f-card-new', overlay).value.trim();
      if (!newCode) { showModalError(overlay, errSel, 'Enter a proximity code to issue.'); return; }
      const { data: newCard, error: cardErr } = await ProximityCardsModel.issueAndReturnId(newCode, appState.session.user.id);
      if (cardErr) { showModalError(overlay, errSel, cardErr.message); return; }
      payload.proximity_card_id = newCard.id;
    } else {
      const chosen = overlay.dataset.chosenCard;
      if (!chosen) { showModalError(overlay, errSel, 'Search and pick an available card, or switch to issuing a new one.'); return; }
      payload.proximity_card_id = chosen;
    }

    let error;
    if (isEdit) {
      payload.updated_by = appState.session.user.id;
      ({ error } = await EmployeesModel.updateEmployee(emp.id, payload));
    } else {
      payload.created_by = appState.session.user.id;
      ({ error } = await EmployeesModel.createEmployee(payload));
    }
    if (error) { showModalError(overlay, errSel, error.message); return; }
    closeModal(overlay);
    toast(isEdit ? 'Employee updated' : 'Employee added');
    onSaved?.();
  });
}
