// The two wirings in this branch: heatmap cells that filter the log, and a
// badge tap that opens the palette on the card code.
//
// Both are DOM glue over logic tested elsewhere (scan-heatmap.test.mjs,
// card-tap.test.mjs, palette-search.test.mjs), so these are source
// assertions on the parts that cannot be unit-tested without a browser —
// chosen for the mistakes that would actually be made.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const modal = code(read('Components/ScanLogModal.js'));
const palette = code(read('Components/CommandPalette.js'));
const css = read('../CSS/components.css');

// ---- heatmap cells filter the log ----

// A styled <i> cannot be tabbed to or activated with a keyboard, and a
// screen reader announces nothing. Once a cell does something it has to be
// a control.
test('cells are real buttons, and empty days are disabled', () => {
  assert.match(modal, /<button type="button"[\s\S]*?class="hm-cell/);
  assert.match(modal, /d\.count \? '' : ' disabled'/,
    'a day with no scans has nothing to filter to');
  assert.match(modal, /aria-pressed=/);
});

// THE BUG THIS PREVENTS. paintHeatmap() replaces the wrapper's contents on
// every repaint. A listener bound to the cells, or to a node that gets
// rebuilt, works once and then silently stops.
test('the click listener is delegated to a node that is never rebuilt', () => {
  assert.match(modal, /\$\('#log-heatmap', overlay\)\.addEventListener\('click'/);
  assert.match(modal, /host\.innerHTML = heatmapHTML\(logs, selectedDay\(\)\)/,
    'the wrapper itself must survive — only its contents are replaced');
  assert.ok(!/outerHTML/.test(modal), 'replacing the wrapper would drop the listener with it');
});

// One source of truth. A second `let selectedDay` would drift from the
// picker the first time someone used Clear.
test('the picker is the selection state, not a variable beside it', () => {
  assert.match(modal, /const selectedDay = \(\) => \{[\s\S]*?drp-from[\s\S]*?drp-to/);
  assert.match(modal, /from && from === to \? from : ''/,
    'a single day is a range whose ends are equal');
});

// A filter you can set from the grid and cannot clear from the grid is worse
// than no filter from the grid.
test('clicking the selected day clears it', () => {
  assert.match(modal, /const next = day === selectedDay\(\) \? '' : day;/);
  assert.match(modal, /picker\?\.set\(\{ from: next, to: next \}\)/);
});

// Redrawing the grid from the filtered set would leave one lit cell and
// twenty-nine blanks — the context is the whole point of the grid.
test('the grid is always drawn from the full log, never the filtered set', () => {
  assert.match(modal, /heatmapHTML\(logs, selectedDay\(\)\)/);
  assert.ok(!/heatmapHTML\(filtered/.test(modal));
});

test('applying or clearing the picker repaints the grid too', () => {
  assert.match(modal, /const paintAll = \(\) => \{ paintHeatmap\(\); paintList\(\); \};/);
  assert.match(modal, /mountDateRangePicker\(\$\('#log-range', overlay\), \{ onApply: paintAll \}\)/,
    'applying a range from the picker must update which cell reads as selected');
});

test('the cell is styled as an interactive control', () => {
  assert.match(css, /\.hm-cell\{[^}]*cursor:pointer/);
  assert.match(css, /\.hm-cell:focus-visible\{[^}]*outline/,
    'keyboard focus must be visible or the buttons are unusable without a mouse');
  assert.match(css, /\.hm-cell:disabled\{[^}]*cursor:default/);
});

// ---- a badge tap opens the palette ----

test('the palette can open prefilled, and selects what it was given', () => {
  assert.match(palette, /export function openPalette\(initialQuery = ''\)/);
  assert.match(palette, /input\.value = String\(initialQuery \|\| ''\)/);
  assert.match(palette, /input\.select\(\)/,
    'the next keystroke should replace the code, not append to it');
});

// THE FAILURE MODE THAT MATTERS: swallowing real typing. Every guard errs
// toward letting the keystroke through.
test('a card tap never competes with something being typed', () => {
  assert.match(palette, /acceptsCardTap\(document\.activeElement/);
  assert.match(palette, /paletteOpen: Boolean\(overlay\)/);
  assert.match(palette, /modalOpen: Boolean\(document\.querySelector\('\.overlay'\)\)/);
  assert.match(palette, /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) \{ tap = emptyTapState\(\); return; \}/,
    'a held modifier is a shortcut someone meant, and must not leave half a code buffered');
});

// Calling preventDefault on every digit would break typing everywhere the
// moment a guard above was wrong. Only the terminating Enter of a COMPLETE
// read is consumed.
test('nothing is intercepted until a whole read is in hand', () => {
  const init = palette.slice(palette.indexOf('export function startCommandPalette'));
  const guard = init.indexOf('if (!code || !isCardRead(code)) return;');
  const prevent = init.indexOf('e.preventDefault();', guard);
  assert.ok(guard !== -1 && prevent !== -1 && guard < prevent,
    'preventDefault must come after the completeness check, not before');
  assert.equal((init.match(/e\.preventDefault\(\)/g) || []).length, 2,
    'exactly two: the Ctrl+K shortcut and the completed card read');
});

// The ranking already treats active_proximity_code as an exact match, which
// is why this feature is a listener rather than a lookup.
test('the search already knows how to match a card code', () => {
  const search = code(read('Utils/paletteSearch.js'));
  assert.match(search, /const card = norm\(row\?\.active_proximity_code\)/);
  assert.match(search, /if \(card && card === needle\) return RANK\.codeExact/);
});

// Focus moves constantly; latching it when the listener is installed would
// read the state from page load rather than from the keystroke.
test('focus is re-read on every key, not captured once', () => {
  const init = palette.slice(palette.indexOf('export function startCommandPalette'));
  assert.match(init, /acceptsCardTap\(document\.activeElement/,
    'reading activeElement inside the handler is what makes the guard current');
});

// ---- the palette must not listen on the kiosk (reported 2026-11-12) ----
//
// It was installed once at startup for the whole app, on the reasoning that
// it reads the rail buttons to decide what it can offer and there are none
// on the kiosk — so it was inert there. The card-tap listener made that
// false: a kiosk's reader is the PRIMARY input, so every badge scan opened
// the palette over the scan result.
//
// acceptsCardTap() was supposed to prevent exactly this by refusing while an
// input has focus, and did not: doScan() DISABLES #ss-code for a second
// after each scan, and a disabled input is not document.activeElement —
// focus falls back to <body>, which reads as "nothing is being typed into".

const screens = code(read('Core/screens.js'));
const scanner = code(read('Features/Scanner/StandaloneScanner.js'));
const main = code(read('main.js'));

test('the palette is started per screen, not once at startup', () => {
  assert.ok(!/initCommandPalette/.test(main),
    'a single startup install is what put the palette on the kiosk');
  assert.match(palette, /export function startCommandPalette/);
  assert.match(palette, /export function stopCommandPalette/);
});

test('only the shell starts it; auth and the kiosk stop it', () => {
  const shell = screens.slice(screens.indexOf('export function showShell'));
  assert.match(shell, /startCommandPalette\(\)/, 'the shell is the only screen it belongs on');

  const auth = screens.slice(screens.indexOf('export function showAuth'), screens.indexOf('function paintNavGroups'));
  assert.match(auth, /stopCommandPalette\(\)/);

  const show = scanner.slice(scanner.indexOf('export function showStandaloneScanner'));
  assert.match(show, /stopCommandPalette\(\)/,
    'a card tap on the kiosk must reach the scan box and nothing else');
});

// REMOVED, not gated. A listener that was never installed cannot be wrong
// about focus — which is the mistake that produced this bug.
test('stopping actually removes the listener', () => {
  const stop = palette.slice(palette.indexOf('export function stopCommandPalette'),
    palette.indexOf('export function startCommandPalette'));
  assert.match(stop, /document\.removeEventListener\('keydown', keyHandler\)/);
  assert.match(stop, /keyHandler = null/);
  assert.match(stop, /tap = emptyTapState\(\)/, 'a half-read must not survive a screen change');
  assert.match(stop, /closePalette\(\)/, 'an open palette must not outlive the screen it opened on');
});

// showShell() runs again on a re-auth, and two handlers would double every
// keystroke into the tap state — which would break the cadence test.
test('starting twice does not install two listeners', () => {
  const start = palette.slice(palette.indexOf('export function startCommandPalette'));
  const stopAt = start.indexOf('stopCommandPalette();');
  const addAt = start.indexOf("document.addEventListener('keydown', keyHandler)");
  assert.ok(stopAt !== -1 && addAt !== -1 && stopAt < addAt,
    'start must remove any existing handler before adding one');
});
