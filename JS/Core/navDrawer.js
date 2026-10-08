// The sidebar's mobile behaviour: below MOBILE_MAX_WIDTH it is a drawer that
// slides over the content instead of a column that competes with it.
//
// The layout is CSS (see layout.css); this only owns the open/closed bit and
// the four ways a drawer should close — the scrim, Escape, picking a route,
// and growing past the breakpoint. That last one matters: a drawer left open
// while someone rotates a tablet would otherwise strand a scrim over a
// perfectly good desktop layout.
import { $ } from '../Utils/dom.js';

export const MOBILE_MAX_WIDTH = 860;

export function isMobileWidth(width) {
  return width <= MOBILE_MAX_WIDTH;
}

export function initNavDrawer() {
  const shell = $('#shell');
  const toggle = $('#nav-toggle');
  const backdrop = $('#nav-backdrop');
  const sidebar = $('#sidebar');
  if (!shell || !toggle || !backdrop) return null;

  const isOpen = () => shell.classList.contains('nav-open');
  const setOpen = (open) => {
    shell.classList.toggle('nav-open', open);
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  // Guarded on isOpen() so this never swallows an Escape a dialog wanted.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
  sidebar?.addEventListener('click', (e) => {
    if (e.target.closest('button[data-route]')) setOpen(false);
  });
  window.addEventListener('resize', () => {
    if (isOpen() && !isMobileWidth(window.innerWidth)) setOpen(false);
  });

  setOpen(false);
  return { setOpen, isOpen };
}
