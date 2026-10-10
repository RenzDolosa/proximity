// A button that opens a short list of actions.
//
// Built for Employee Manager's two exports, which sat in the toolbar as two
// separate buttons competing for the same glance — "Export" and "Export all
// scan logs" are the same intent with different scope, so they belong under
// one control with the scope as the choice.
//
// Deliberately small: no submenus, no icons, no keyboard roving. A toolbar
// overflow menu with four entries does not need a menu framework, and the
// native focus order through plain <button>s already works.
import { esc } from '../Utils/format.js';

/**
 * @param {string} id
 * @param {string} label  the trigger's text
 * @param {Array<{ id: string, label: string, hint?: string }>} items
 * @param {{ className?: string }} [opts]
 */
export function menuHTML(id, label, items, { className = 'ghost' } = {}) {
  return `
    <div class="menu" id="${esc(id)}">
      <button type="button" class="${esc(className)} menu-trigger" aria-haspopup="menu" aria-expanded="false">
        ${esc(label)}<span class="menu-caret" aria-hidden="true">▾</span>
      </button>
      <div class="menu-pop" role="menu" hidden>
        ${items.map((i) => `
          <button type="button" role="menuitem" data-menu-item="${esc(i.id)}">
            <span class="menu-item-label">${esc(i.label)}</span>
            ${i.hint ? `<span class="menu-item-hint">${esc(i.hint)}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`;
}

/**
 * Wires a rendered menu. `onSelect(itemId)` fires once per click, after the
 * menu closes — so a handler that opens a modal is not fighting a popover
 * that is still on screen.
 */
export function mountMenu(root, { onSelect } = {}) {
  if (!root) return null;
  const trigger = root.querySelector('.menu-trigger');
  const pop = root.querySelector('.menu-pop');

  const setOpen = (open) => {
    pop.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // Flip left when a right-edge toolbar would push this off screen — the
    // same problem the date picker hit, and the same measured fix.
    root.classList.remove('menu-end');
    if (pop.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      root.classList.add('menu-end');
    }
  };

  trigger.addEventListener('click', () => setOpen(pop.hidden));
  root.querySelectorAll('[data-menu-item]').forEach((b) => b.addEventListener('click', () => {
    setOpen(false);
    onSelect?.(b.dataset.menuItem);
  }));

  const onDocPointer = (e) => { if (!root.contains(e.target)) setOpen(false); };
  document.addEventListener('pointerdown', onDocPointer);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pop.hidden) return;
    setOpen(false);
    trigger.focus();
    e.stopPropagation();
  });

  setOpen(false);
  return { destroy: () => document.removeEventListener('pointerdown', onDocPointer) };
}
