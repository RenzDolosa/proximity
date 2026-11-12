// Which build this page is actually running.
//
// WHY IT DID NOT EXIST, AND WHY IT MATTERS NOW. Nothing in the app rendered
// a version, so "did that fix reach the kiosk by the loading bay?" was
// answered by walking over and guessing. That question came up for real on
// 2026-11-12, when a command-palette listener had to be kept off the kiosk
// and the only advice available was "reload the tab".
//
// STAMPED AT DEPLOY TIME. The literal below is a placeholder; the Cloudflare
// workflow rewrites this one line to the commit SHA before publishing, and
// rewrites sw.js's VERSION to the same value in the same step. That is the
// whole mechanism behind the update signal working again:
//
//   a Service Worker is only reinstalled when its own FILE BYTES change.
//   sw.js was byte-identical across 79 commits that touched JS/CSS, so the
//   browser never saw an update, `activate` never ran, and the
//   `app-updated` message in Utils/appUpdate.js was never posted. Tab age
//   — twelve hours — was the only path left.
//
// DO NOT "FIX" THIS BACK TO A HARDCODED STRING. It looks like a constant
// somebody forgot to maintain, which is exactly what VERSION in sw.js looked
// like for two months. test/build-stamp.test.mjs pins the workflow step that
// rewrites it, so the two cannot drift apart silently.
export const BUILD = 'dev';

/** True when running from a checkout rather than a deploy. */
export function isDevBuild(build = BUILD) {
  return !build || build === 'dev';
}

/**
 * Short, human-comparable form. A reader is matching it against a commit in
 * GitHub, not reading it aloud.
 */
export function shortBuild(build = BUILD) {
  const s = String(build || '').trim();
  if (!s || s === 'dev') return 'dev';
  return s.slice(0, 7);
}
