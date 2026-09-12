import { $, $$ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal } from './Modal.js';
import { isAdminOrManager } from '../Core/state.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';

// Viewer + editor for an employee's remarks (employees.remarks_log — a
// general-purpose note log; revoke_proximity_card() writes into the same
// column, so a revoked card's reason shows up here automatically).
export async function openRemarksModal(employeeId) {
  const overlay = openModal(`
    <h3 id="rm-title">Remarks</h3>
    <div id="rm-body" class="empty-state">Loading…</div>
  `, { maxWidth: '480px' });

  const { data: emp, error } = await EmployeesModel.getRemarks(employeeId);
  const bodyEl = $('#rm-body', overlay);
  if (error) { bodyEl.textContent = error.message; return; }
  $('#rm-title', overlay).textContent = `Remarks — ${emp.full_name}`;

  let remarks = (emp.remarks_log || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  function paint() {
    bodyEl.className = '';
    bodyEl.innerHTML = `
      ${isAdminOrManager() ? `
        <div class="field" style="margin-bottom:12px;">
          <textarea id="rm-new" rows="2" placeholder="Add a remark…" style="width:100%;resize:vertical;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:var(--radius);font-family:var(--sans);font-size:13px;"></textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:6px;">
            <button class="ghost" id="rm-add">Add remark</button>
          </div>
        </div>
      ` : ''}
      ${!remarks.length ? `
        <div class="empty-state"><strong>No remarks yet</strong>Notes on this employee — including card-revocation reasons — show up here.</div>
      ` : `
        <div style="max-height:320px;overflow-y:auto;">
          ${remarks.map((r) => `
            <div class="feed-row" style="align-items:flex-start;">
              <span class="badge ${r.resolved ? 'active' : 'suspended'}" style="margin-top:2px;">${r.resolved ? 'Resolved' : 'Open'}</span>
              <div style="min-width:0;flex:1;">
                <div>${esc(r.remark)}</div>
                <div class="emp-meta" style="margin-top:2px;">${esc(r.created_by || 'Unknown')} · ${fmtTime(r.created_at)}</div>
              </div>
              ${isAdminOrManager() ? `<button class="ghost" data-toggle="${r.id}" style="padding:4px 8px;font-size:11.5px;flex-shrink:0;">${r.resolved ? 'Reopen' : 'Resolve'}</button>` : ''}
            </div>
          `).join('')}
        </div>
      `}
      <div class="actions">
        <button class="ghost" id="rm-close">Close</button>
      </div>
    `;
    $('#rm-close', overlay).addEventListener('click', () => closeModal(overlay));
    if (isAdminOrManager()) {
      $('#rm-add', overlay).addEventListener('click', async () => {
        const text = $('#rm-new', overlay).value.trim();
        if (!text) return;
        const { data: entry, error: addErr } = await EmployeesModel.addRemark(employeeId, text);
        if (addErr) { toast(addErr.message, 'error'); return; }
        remarks = [entry, ...remarks];
        paint();
      });
      $$('button[data-toggle]', overlay).forEach((b) => b.addEventListener('click', async () => {
        const target = remarks.find((r) => r.id === b.dataset.toggle);
        const nextResolved = !target.resolved;
        const { error: resErr } = await EmployeesModel.resolveRemark(employeeId, target.id, nextResolved);
        if (resErr) { toast(resErr.message, 'error'); return; }
        target.resolved = nextResolved;
        paint();
      }));
    }
  }

  paint();
}
