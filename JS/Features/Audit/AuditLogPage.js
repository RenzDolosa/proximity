// Admin-only, read-only view over audit_log (via get_audit_log()). Every
// row here comes from log_audit_event(), called either directly by an RPC
// (revoke_proximity_card, resolve_employee_remark, delete_employee_scan_log)
// or by a database trigger reacting to a delete/update (trg_audit_employee_delete,
// trg_audit_proximity_card_delete, trg_audit_profile_changes) — see
// Supabase/README.md's "Audit log" section for the full list and why each
// one logs what it does. describeEvent() below is this page's own
// translation from that raw {action, entity_type, detail} shape into a
// sentence a human reads at a glance; it has one entry per action this
// schema currently emits, plus a generic fallback so an action added to
// the database later without a matching update here still renders
// something reasonable instead of breaking.
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { isAdmin } from '../../Core/state.js';
import { AuditLogModel } from '../../Models/AuditLogModel.js';
import { renderPagination } from '../../Components/Pagination.js';

let rowsCache = [];
let page = 1;
let pageSize = 50;
let loaded = false; // distinguishes "never fetched yet" from "fetched, zero rows"

export async function renderAuditLog() {
  const content = $('#content');
  if (!isAdmin()) { content.innerHTML = `<div class="empty-state">Admins only.</div>`; return; }
  content.innerHTML = `
    <div class="toolbar">
      <div class="sub">Every destructive or permission-changing action taken in this app — who, what, and when. Read-only; nothing here can be edited or deleted.</div>
    </div>
    <div class="table-scroll"><div id="audit-table-wrap">${loaded ? '' : 'Loading…'}</div></div>
    <div id="audit-pagination"></div>
  `;

  // Stale-while-revalidate: paint from cache immediately (no "Loading…"
  // flash) while the fresh fetch runs, if we've already loaded once —
  // same pattern as UsersPage.js.
  if (loaded) paintAuditTable();

  const { data, error } = await AuditLogModel.list();
  const wrap = $('#audit-table-wrap');
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  rowsCache = data || [];
  loaded = true;
  page = 1;
  paintAuditTable();
}

function paintAuditTable() {
  const wrap = $('#audit-table-wrap');
  const data = rowsCache;
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">No audited actions yet.</div>`; $('#audit-pagination').innerHTML = ''; return; }
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  const rows = data.slice((page - 1) * pageSize, page * pageSize);
  wrap.innerHTML = `
    <table>
      <thead><tr><th class="col-shrink">Time</th><th class="col-shrink">Actor</th><th>Event</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td class="col-shrink mono">${fmtTime(r.created_at)}</td>
            <td class="col-shrink">${esc(r.actor_name || '—')}</td>
            <td>${describeEvent(r)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  renderPagination($('#audit-pagination'), {
    total: data.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintAuditTable(); },
  });
}

// Renders one row's `action` + `entity_type` + `detail` into a sentence,
// falling back to the raw action string for anything not listed here
// (see this file's top-of-file comment for why that matters).
function describeEvent(r) {
  const d = r.detail || {};
  switch (r.action) {
    case 'employee_deleted':
      return `Deleted employee <strong>${esc(d.full_name || r.entity_id)}</strong>${d.employee_code ? ` <span class="emp-meta mono">(${esc(d.employee_code)})</span>` : ''}`;
    case 'proximity_card_deleted':
      return `Deleted proximity card <span class="mono">${esc(d.proximity_code || r.entity_id)}</span>`;
    case 'card_revoked':
      return `Revoked proximity card <span class="mono">${esc(d.proximity_code || r.entity_id)}</span>${d.reason ? ` — <em>${esc(d.reason)}</em>` : ''}`;
    case 'remark_resolved':
      return `Resolved a remark on an employee's record`;
    case 'remark_reopened':
      return `Reopened a remark on an employee's record`;
    case 'scan_log_entry_deleted':
      return `Deleted one scan log entry from an employee's record`;
    case 'account_changed': {
      // Only the fields the trigger actually saw change are worth listing
      // — trg_audit_profile_changes always includes all three in `detail`
      // regardless of which one(s) triggered the log, so from===to fields
      // here are just noise, not a real change to report.
      const changes = [];
      if (d.role && d.role.from !== d.role.to) changes.push(`role <span class="badge role-${esc(d.role.from)}">${esc(d.role.from)}</span> → <span class="badge role-${esc(d.role.to)}">${esc(d.role.to)}</span>`);
      if (d.access_scope && d.access_scope.from !== d.access_scope.to) changes.push(`access ${esc(d.access_scope.from)} → ${esc(d.access_scope.to)}`);
      if (d.is_active && d.is_active.from !== d.is_active.to) changes.push(d.is_active.to ? 'account enabled' : 'account disabled');
      return `Changed <strong>${esc(d.full_name || r.entity_id)}</strong>'s account — ${changes.join(', ') || 'no net change'}`;
    }
    default:
      // Unknown action (schema evolved ahead of this page) — still show
      // something useful rather than a blank cell or a thrown error.
      return `<span class="mono">${esc(r.action)}</span> on ${esc(r.entity_type)}${r.entity_id ? ` <span class="emp-meta mono">${esc(r.entity_id)}</span>` : ''}`;
  }
}