// Ctrl/Cmd+K — jump to any employee or any page without navigating there.
//
// Searches what is already in memory (appState.employeesCache plus the route
// list), so it costs no request and works offline.
//
// WHICH ROUTES IT OFFERS is read from the rail buttons' own .hidden state,
// exactly as Core/screens.js's paintNavGroups() does, rather than re-deriving
// permissions here. That is the rule this file must not break: one place
// decides what an account can see, and a second opinion is how a palette ends
// up offering a scanner-only kiosk a route to the audit log.
import { $, $$ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { appState } from '../Core/state.js';
import { GROUPED_ROUTES, ROUTE_TITLES } from '../Core/navGroups.js';
import { searchPalette, moveSelection } from '../Utils/paletteSearch.js';
import { emptyTapState, feedKey, acceptsCardTap, isCardRead } from '../Utils/cardTap.js';

let overlay = null;
let results = [];
let selected = 0;

function visibleRoutes() {
  return GROUPED_ROUTES.filter((route) => {
    const btn = $(`nav.rail button[data-route="${route}"]`);
    return Boolean(btn) && !btn.classList.contains('hidden');
  });
}

export function isPaletteOpen() { return Boolean(overlay); }

export function closePalette() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  results = [];
  selected = 0;
}

/**
 * @param {string} [initialQuery] prefilled and searched immediately — used by
 *   the card-tap listener below, which has a code and no reason to make
 *   anyone retype it.
 */
export function openPalette(initialQuery = '') {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'cmdk-overlay';
  overlay.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Search">
      <input id="cmdk-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="Search people, cards, or pages…" aria-controls="cmdk-list" />
      <div id="cmdk-list" class="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot emp-meta">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>enter</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = $('#cmdk-input', overlay);
  const paint = () => {
    results = searchPalette({
      query: input.value,
      employees: appState.employeesCache,
      routes: visibleRoutes(),
      titles: ROUTE_TITLES,
    });
    selected = 0;
    paintList();
  };

  input.addEventListener('input', paint);
  input.addEventListener('keydown', onKey);
  // Clicking the backdrop closes; clicking inside the panel must not.
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePalette(); });
  $('#cmdk-list', overlay).addEventListener('click', (e) => {
    const row = e.target.closest('[data-index]');
    if (row) choose(Number(row.dataset.index));
  });

  input.value = String(initialQuery || '');
  paint();
  input.focus();
  // Selected, not just placed: a card tap that matched one person should let
  // the next keystroke replace the code rather than append to it.
  input.select();
}

function paintList() {
  const list = $('#cmdk-list', overlay);
  if (!list) return;
  if (!results.length) {
    list.innerHTML = '<div class="cmdk-empty emp-meta">Nothing matches. People are searched from the copy Employee Manager already loaded — open it once if this looks short.</div>';
    return;
  }
  list.innerHTML = results.map((r, i) => `
    <div class="cmdk-row${i === selected ? ' is-sel' : ''}" role="option"
         aria-selected="${i === selected}" data-index="${i}">
      <span class="cmdk-kind">${r.kind === 'route' ? 'page' : 'person'}</span>
      <span class="cmdk-label">${esc(r.label)}</span>
      <span class="cmdk-hint emp-meta">${esc(r.hint || '')}</span>
    </div>`).join('');
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = moveSelection(selected, e.key === 'ArrowDown' ? 1 : -1, results.length);
    paintList();
    $('.cmdk-row.is-sel', overlay)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
}

async function choose(index) {
  const hit = results[index];
  if (!hit) return;
  closePalette();
  if (hit.kind === 'route') {
    appState.route = hit.route;
    const { render } = await import('../Core/router.js');
    render();
    return;
  }
  // A person resolves to Employee Manager with their name in the search box.
  // Opening their record straight from here would need the row's full shape,
  // and the palette deliberately holds only what the grid already cached.
  appState.route = 'directory';
  const { render } = await import('../Core/router.js');
  render();
  const search = $('#dir-search');
  if (search) {
    search.value = hit.row?.employee_code || hit.label;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
  }
}

// NOT INSTALLED ON THE KIOSK, and the listener is removed rather than gated.
//
// This used to be a single init() at startup, on the reasoning that the
// palette reads the rail buttons to decide what it can offer and there are
// none on the standalone scanner — so it was inert there. The card-tap
// listener broke that: on a kiosk the reader is the PRIMARY input, so every
// badge scan opened the palette over the scan result (reported 2026-11-12,
// with "0005267898 — nothing matches" covering the person's photo).
//
// `acceptsCardTap()` was supposed to prevent exactly this by refusing while
// an input has focus, and it did not, because doScan() DISABLES #ss-code for
// a second after each scan to stop a second read piling onto the first —
// and a disabled input is not document.activeElement. Focus falls back to
// <body>, which reads as "nothing is being typed into".
//
// A gate that subtle is the wrong mechanism for a screen the palette has no
// business being on at all. Screens.js already starts and stops the alerts
// badge per screen; the palette now follows the same rule, and a listener
// that was never installed cannot be wrong about focus.
let keyHandler = null;
let tap = emptyTapState();

export function stopCommandPalette() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  tap = emptyTapState();
  closePalette();
}

export function startCommandPalette() {
  // Idempotent: showShell() runs again on a re-auth, and two handlers would
  // double every keystroke into the tap state.
  stopCommandPalette();

  // A badge reader is a keyboard wedge, so a card tapped on a desk reader
  // arrives here as a burst of keystrokes ending in Enter. Catching it opens
  // the palette on that code, and the ranking in paletteSearch.js already
  // treats `active_proximity_code` as an exact match — so "whose card is
  // this?" is answered from the rows in memory, with no request and nothing
  // typed. See Utils/cardTap.js for how a reader is told from a person.
  keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (overlay) closePalette(); else openPalette();
      return;
    }

    // A wedge sends no modifiers, and anything held down is a shortcut
    // someone meant. Checked before the state machine so a Ctrl-chord cannot
    // leave half a code in the buffer.
    if (e.ctrlKey || e.metaKey || e.altKey) { tap = emptyTapState(); return; }

    // Re-read on every key rather than latched: focus moves constantly, and
    // the only moment that matters is the one the keystroke arrived in.
    if (!acceptsCardTap(document.activeElement, {
      paletteOpen: Boolean(overlay),
      modalOpen: Boolean(document.querySelector('.overlay')),
    })) {
      tap = emptyTapState();
      return;
    }

    const { state, code } = feedKey(tap, { key: e.key, at: e.timeStamp });
    tap = state;
    if (!code || !isCardRead(code)) return;
    // Only now, with a complete read in hand, is the Enter consumed. Every
    // earlier keystroke was allowed through untouched — nothing is
    // intercepted on the strength of a guess about where the burst is going.
    e.preventDefault();
    openPalette(code.trim());
  };
  document.addEventListener('keydown', keyHandler);
}
