// Click-to-copy wiring shared by any table column that shows a proximity
// code as clickable text — the Employee Manager's Proximity ID column and
// the Proximity Cards page's Proximity code column both use this, rather
// than each maintaining its own copy of the same try/catch. Pairs with the
// `.copyable-code` class in CSS/base.css (the dotted-underline hover
// affordance) — markup should look like:
//   <span class="copyable-code" data-copy-code="${esc(code)}" title="Click to copy">${esc(code)}</span>
import { $$ } from './dom.js';
import { toast } from './toast.js';

// Finds every [data-copy-code] element under `wrap` and wires it to copy
// its data-copy-code value on click. successLabel lets each caller word
// the toast for its own context (e.g. "Copied proximity code") while
// sharing the same clipboard-write + error-handling logic.
export function wireCopyableCodes(wrap, successLabel = 'Copied proximity code') {
  $$('[data-copy-code]', wrap).forEach((el) => el.addEventListener('click', async () => {
    const code = el.dataset.copyCode;
    try {
      await navigator.clipboard.writeText(code);
      toast(successLabel);
    } catch {
      toast('Could not copy — your browser blocked clipboard access', 'error');
    }
  }));
}
