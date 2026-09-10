import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { openCardModal } from '../../Components/ProximityCardModal.js';

export async function renderProximity() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div></div>
      ${isAdminOrManager() ? '<button class="primary" id="prox-add">+ Issue proximity card</button>' : ''}
    </div>
    <div id="prox-table-wrap">Loading…</div>
  `;
  if (isAdminOrManager()) $('#prox-add').addEventListener('click', () => openCardModal(renderProximity));

  const [{ data, error }, { data: emps }] = await Promise.all([
    ProximityCardsModel.listForTable(),
    EmployeesModel.listForCardAssignment(),
  ]);
  const wrap = $('#prox-table-wrap');
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  const byCard = new Map((emps || []).map((e) => [e.proximity_card_id, e]));
  if (!data.length) { wrap.innerHTML = `<div class="empty-state"><strong>No proximity cards yet</strong>Issue a card — it doesn't need to be assigned to anyone right away.</div>`; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Proximity code</th><th>Assigned to</th><th>Status</th><th>Issued</th><th></th></tr></thead>
      <tbody>
        ${data.map((c) => { const e = byCard.get(c.id); return `
          <tr>
            <td class="mono">${esc(c.proximity_code)}</td>
            <td>${e ? esc(e.full_name) + ' <span class="emp-meta mono">(' + esc(e.employee_code) + ')</span>' : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td><span class="badge ${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'revoked'}</span></td>
            <td>${fmtTime(c.issued_at)}</td>
            <td class="row-actions">
              ${isAdminOrManager() && c.is_active ? `<button class="ghost" data-revoke="${c.id}" style="color:var(--warn)">Revoke</button>` : ''}
              ${isAdminOrManager() && !c.is_active ? `<button class="ghost" data-renew="${c.id}" style="color:var(--good)">Renew</button>` : ''}
              ${isAdmin() && !e ? `<button class="ghost" data-del="${c.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `; }).join('')}
      </tbody>
    </table>
  `;
  $$('button[data-revoke]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await ProximityCardsModel.revoke(b.dataset.revoke);
    if (error) toast(error.message, 'error'); else { toast('Card revoked'); renderProximity(); }
  }));
  $$('button[data-renew]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await ProximityCardsModel.renew(b.dataset.renew);
    if (error) toast(error.message, 'error'); else { toast('Card renewed'); renderProximity(); }
  }));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Permanently delete this card record?')) return;
    const { error } = await ProximityCardsModel.remove(b.dataset.del);
    if (error) toast(error.message, 'error'); else { toast('Card deleted'); renderProximity(); }
  }));
}
