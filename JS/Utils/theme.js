// Dark/light theme preference. Dark is the default (matches the app's
// original, only-ever-had-one look — see CSS/variables.css) and needs no
// attribute at all; light mode is opted into via html[data-theme="light"].
//
// This module is NOT what prevents the flash-of-wrong-theme on load —
// it can't be: it's an ES module, and ES modules (this app's entire
// JS/main.js tree) are deferred until after the HTML has been parsed and
// the browser has already started painting with whatever CSS matched at
// that point. By the time this module's code could run, a saved "light"
// preference would already have flashed dark for one frame. The actual
// fix is the tiny inline, non-module <script> at the very top of
// Public/index.html's <head>, which runs synchronously before the
// stylesheet is even requested. That inline script is deliberately kept
// to the same two lines duplicated below (read localStorage, set the
// attribute) rather than importing this module, for exactly that reason
// — it can't afford to be a module.
//
// This module IS what Settings' Appearance toggle (and anything else
// that needs to read or change the preference after the page has
// already loaded) uses — one shared, tested place for the key name and
// the read/write logic, so the early inline script and the interactive
// toggle can never drift out of sync on what "light" actually means.
const STORAGE_KEY = 'proximity-theme';

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    // localStorage can throw in some locked-down/private-browsing
    // contexts — falling back to dark (the default look) rather than
    // letting a theme preference read crash anything real.
    return 'dark';
  }
}

export function setTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  if (normalized === 'light') {
    document.documentElement.dataset.theme = 'light';
  } else {
    delete document.documentElement.dataset.theme; // dark needs no attribute — see the file header
  }
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // best-effort — the theme still applies for this page view even if
    // it can't be persisted for next time.
  }
}