// Small progress dialog for bulk operations (currently: "Delete all" on
// Employee Manager and Proximity Cards). The operation itself is a couple
// of chunked bulk SQL calls, not one-row-at-a-time round-trips, so this
// bar isn't simulating anything — for a typical table (well under a
// chunk's size) it goes from 0 to 100% in a single tick, i.e. instant. For
// a much larger table it ticks up chunk by chunk so it's still obvious
// something's happening rather than the UI just sitting there frozen.
import { esc } from '../Utils/format.js';
import { openModal, closeModal } from './Modal.js';

/**
 * @param {string} title
 * @returns {{ update: (done:number, total:number) => void, close: () => void }}
 */
export function openProgressModal(title) {
  const overlay = openModal(`
    <h3>${esc(title)}</h3>
    <div class="progress-bar"><div class="progress-bar-fill" id="pm-fill"></div></div>
    <div class="progress-label" id="pm-label">Starting…</div>
  `, { maxWidth: '360px' });

  return {
    update(done, total) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 100;
      const fill = overlay.querySelector('#pm-fill');
      fill.style.width = `${pct}%`;
      fill.classList.toggle('done', pct >= 100);
      overlay.querySelector('#pm-label').textContent = `${done} / ${total}`;
    },
    close() {
      closeModal(overlay);
    },
  };
}
