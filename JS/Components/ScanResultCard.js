// Renders the outcome of one scan_proximity_code()/test_scan_proximity_code()
// RPC call. Shared by the standalone scanner tab and Test Scan; kept as a
// pure function so it's trivial to reuse anywhere else a scan result needs
// to be shown.
//
// Always renders the photo from photo_thumb_b64 (offlineAvatarHTML — see
// Utils/format.js), even for a live/online scan, so one code path renders
// identically online or offline. The standalone scanner's live RPC omits that
// field and the scanner re-attaches it from its local photo cache
// (OfflineScanModel.withCachedPhoto()) before calling this; Test Scan's RPC
// still includes it.
import { esc, offlineAvatarHTML } from '../Utils/format.js';

const LABELS = {
  matched: 'Access granted',
  unmatched: 'Unknown proximity ID',
  inactive_card: 'Card revoked',
  inactive_employee: 'Employee inactive',
  unassigned_card: 'Card not assigned',
};

export function renderScanResult(data) {
  const result = data.result;
  if (result === 'matched' && data.employee) {
    const e = data.employee;
    // Both scan RPCs include only unresolved remarks, which are the entries
    // this result card can display — no extra fetch is needed.
    const unresolved = (e.remarks_log || []).filter((r) => !r.resolved);
    return `
      <div class="result-card matched">
        <span class="badge matched">${esc(LABELS[result])}</span>
        ${data.direction ? `<span class="badge ${data.direction === 'out' ? 'suspended' : 'active'}" style="margin-left:6px;">${esc(data.direction.toUpperCase())}</span>` : ''}
        <div class="emp-line" style="margin-top:12px;">
          <div class="avatar">${offlineAvatarHTML(e.full_name, e.photo_thumb_b64)}</div>
          <div class="result-ident">
            <div class="emp-name">${esc(e.full_name)}</div>
            <!-- One field per line rather than a single dot-separated run:
                 on a kiosk this is read at a glance from a step back, and a
                 run of small text separated by dots is the hardest version
                 of that to scan. -->
            <dl class="result-fields">
              <dt>Department</dt><dd>${esc(e.department || '—')}</dd>
              <dt>Position</dt><dd>${esc(e.position || '—')}</dd>
              <dt>Code</dt><dd class="mono">${esc(e.employee_code)}</dd>
            </dl>
          </div>
        </div>
        ${unresolved.length ? `
          <div class="remark-flag">
            <div class="remark-flag-title">⚠ Unresolved remark${unresolved.length > 1 ? 's' : ''} (${unresolved.length})</div>
            ${unresolved.map((r) => `<div class="remark-flag-item">${esc(r.remark)}</div>`).join('')}
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