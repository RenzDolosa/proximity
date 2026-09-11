// Remarks/notes log for an employee — same append-only jsonb pattern as
// scan_logs, but written to by the admin/manager instead of the scanner
// RPC. Appends go through EmployeesModel.addRemark() (add_employee_remark
// RPC) so concurrent adds don't clobber each other.
import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { openModal, closeModal, startModalOpen, isStaleModalOpen } from './Modal.js';
import { toast } from '../Utils/toast.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';

export async function openRemarksModal(employeeId) {
  const token = startModalOpen();
  const overlay = openModal(`
    <h3 id="remarks-title">Remarks</h3>
    <div id="remarks-body" class="empty-state">Loading…</div>
    <div class="actions">
      <button class="ghost" id="remarks-close">Close</button>
    </div>
  `, { maxWidth: '520px' });

  $('#remarks-close', overlay).addEventListener('click', () => closeModal(overlay));

  const load = async () => {
    const { data: emp, error } = await EmployeesModel.getRemarks(employeeId);
    if (isStaleModalOpen(token)) return; // superseded by a newer click before this resolved
    const bodyEl = $('#remarks-body', overlay);
    if (error) { bodyEl.textContent = error.message; return; }
    $('#remarks-title', overlay).textContent = `Remarks — ${emp.full_name}`;
    const remarks = (emp.remarks_log || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    bodyEl.className = '';
    bodyEl.innerHTML = `
      <div class="field" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:14px;">
        <textarea id="remark-input" rows="2" placeholder="Add a remark…" style="flex:1;resize:vertical;"></textarea>
        <button class="primary" id="remark-add" style="flex-shrink:0;">Add</button>
      </div>
      <div id="remarks-list" style="max-height:300px;overflow-y:auto;">
        ${remarks.length ? remarks.map((r) => `
          <div class="feed-row" style="align-items:flex-start;">
            <div style="flex:1;">
              <div>${esc(r.remark)}</div>
              <div class="emp-meta mono">${esc(r.created_by || 'Unknown')}</div>
            </div>
            <div class="feed-time">${fmtTime(r.created_at)}</div>
          </div>
        `).join('') : `<div class="empty-state">No remarks yet.</div>`}
      </div>
    `;

    $('#remark-add', overlay).addEventListener('click', async () => {
      const input = $('#remark-input', overlay);
      const text = input.value.trim();
      if (!text) return;
      const btn = $('#remark-add', overlay);
      btn.disabled = true;
      const { error: addError } = await EmployeesModel.addRemark(employeeId, text);
      btn.disabled = false;
      if (addError) { toast(addError.message, 'error'); return; }
      load();
    });
  };

  await load();
}
