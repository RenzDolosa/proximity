import { $, $$ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { appState } from '../Core/state.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../Models/ProximityCardsModel.js';

export async function openEmployeeModal(emp, onSaved) {
  const isEdit = !!emp;

  // unassigned, active cards + (when editing) the employee's own current card
  const { data: allCards } = await ProximityCardsModel.listAll();
  const { data: linkedRows } = await EmployeesModel.listCardLinks();
  const linkedIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));
  const availableCards = (allCards || []).filter((c) => c.is_active && (!linkedIds.has(c.id) || c.id === emp?.proximity_card_id));

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
      ${isEdit && emp?.proximity_card_id ? `<div class="emp-meta" style="margin-bottom:6px;">Currently assigned: <span class="mono" id="f-card-current"></span></div>` : ''}
      <input id="f-card-search" class="mono" placeholder="Search proximity codes…" autocomplete="off" autofocus />
      <div id="f-card-results" class="search-results"></div>
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
  if (!availableCards.length) { $('#f-card-mode', overlay).value = 'new'; $('#f-card-mode', overlay).dispatchEvent(new Event('change')); }

  // ---- live-search combobox for proximity card selection ----
  overlay.dataset.chosenCard = emp?.proximity_card_id || '';
  const currentCard = availableCards.find((c) => c.id === emp?.proximity_card_id);
  if ($('#f-card-current', overlay) && currentCard) $('#f-card-current', overlay).textContent = currentCard.proximity_code;

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
  paintCardResults('');
  $('#f-card-search', overlay).addEventListener('input', (e) => paintCardResults(e.target.value));

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
