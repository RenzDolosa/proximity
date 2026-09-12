// Renders the outcome of one scan_proximity_code()/test_scan_proximity_code()
// RPC call. Shared by the standalone scanner tab and Test Scan; kept as a
// pure function so it's trivial to reuse anywhere else a scan result needs
// to be shown.
import { esc, initials } from '../Utils/format.js';

const LABELS = {
  matched: 'Access granted',
  unmatched: 'Unknown proximity ID',
  inactive_card: 'Card revoked',
  inactive_employee: 'Employee inactive',
};

export function renderScanResult(data) {
  const result = data.result;
  if (result === 'matched' && data.employee) {
    const e = data.employee;
    // Both scan RPCs return the full employee row (via to_jsonb), so
    // remarks_log rides along on every matched scan — no extra fetch
    // needed to flag it right here at the point of contact.
    const unresolved = (e.remarks_log || []).filter((r) => !r.resolved);
    return `
      <div class="result-card matched">
        <span class="badge matched">${esc(LABELS[result])}</span>
        ${data.direction ? `<span class="badge ${data.direction === 'out' ? 'suspended' : 'active'}" style="margin-left:6px;">${esc(data.direction.toUpperCase())}</span>` : ''}
        <div class="emp-line" style="margin-top:12px;">
          <div class="avatar">${esc(initials(e.full_name))}</div>
          <div>
            <div class="emp-name">${esc(e.full_name)}</div>
            <div class="emp-meta">${esc(e.department || '—')} · ${esc(e.position || '—')} · <span class="mono">${esc(e.employee_code)}</span></div>
          </div>
        </div>
        ${unresolved.length ? `
          <div class="remark-flag">
            <div class="remark-flag-title">⚠ Unresolved remark${unresolved.length > 1 ? 's' : ''} (${unresolved.length})</div>
            <div class="remark-flag-item">See Employee Manager for details.</div>
          </div>
        ` : ''}
      </div>
    `;
  }
  return `
    <div class="result-card ${result}">
      <span class="badge ${result}">${esc(LABELS[result] || result)}</span>
      <div class="emp-meta" style="margin-top:8px;">No active employee was matched to this scan.</div>
    </div>
  `;
}
