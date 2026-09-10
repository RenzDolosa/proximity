import { $ } from '../../Utils/dom.js';
import { loadScanFeed } from '../../Components/ScanFeed.js';

export async function renderScanner() {
  const content = $('#content');
  content.innerHTML = `
    <div class="scan-wrap">
      <div>
        <div class="panel" style="text-align:center;padding:36px 24px;">
          <div style="font-size:32px;margin-bottom:8px;">▣</div>
          <div style="font-weight:600;font-size:15px;margin-bottom:6px;">The scanner opens in its own tab</div>
          <div class="emp-meta" style="margin-bottom:18px;">Keeps the console open on one screen while a dedicated tab runs on the reader station.</div>
          <button class="primary" id="scan-open">Open scanner ↗</button>
        </div>
      </div>
      <div class="panel">
        <div style="font-weight:600;margin-bottom:10px;font-size:13px;">Recent activity</div>
        <div id="scan-feed">Loading…</div>
      </div>
    </div>
  `;
  $('#scan-open').addEventListener('click', () => window.open(location.pathname + '?scanner=1', '_blank', 'noopener'));
  loadScanFeed();
}
