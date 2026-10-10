import test from 'node:test';
import assert from 'node:assert/strict';
import { panelNote } from '../JS/Components/PanelNote.js';

// What this guards: Settings panels each carried one to three paragraphs in a
// single <p>, which at 375px is ten or twelve lines of prose above the
// controls. The split has to keep the detail reachable, not drop it -- the
// paragraph saying "nothing is deleted" is the reason an admin is willing to
// press "Run archival now".

test('a short note stays a plain paragraph with no disclosure', () => {
  const html = panelNote('Audio clips played on the live Scanner.');
  assert.match(html, /Audio clips played on the live Scanner\./);
  assert.ok(!html.includes('<details'), 'a one-liner needs nothing to expand');
});

test('whitespace-only detail counts as no detail', () => {
  // Template literals in the callers span lines, so an "empty" branch easily
  // arrives as "\n   " rather than ''.
  for (const blank of ['', '   ', '\n  \n']) {
    assert.ok(!panelNote('Lead.', blank).includes('<details'));
  }
});

test('the lead is visible and the detail is behind a disclosure', () => {
  const html = panelNote('Lead sentence.', '<p>The long explanation.</p>');
  const lead = html.indexOf('Lead sentence.');
  const summary = html.indexOf('<summary>');
  const detail = html.indexOf('The long explanation.');
  assert.ok(lead !== -1 && summary !== -1 && detail !== -1);
  assert.ok(lead < summary, 'the lead reads before the control that hides the rest');
  assert.ok(summary < detail, 'the detail sits inside the disclosure, not before it');
});

test('the detail is collapsed, so it costs no height until asked for', () => {
  const html = panelNote('Lead.', '<p>Detail.</p>');
  assert.match(html, /<details class="panel-note-more">/);
  assert.ok(!/<details[^>]*\bopen\b/.test(html), 'open would defeat the point');
});

test('markup in either half is preserved, not escaped', () => {
  // Callers pass already-escaped values and real <strong> emphasis; a
  // component that escaped its input would print the tags.
  const html = panelNote('Lead.', '<p><strong>Nothing is deleted</strong> — exports still reach it.</p>');
  assert.match(html, /<strong>Nothing is deleted<\/strong>/);
  assert.ok(!html.includes('&lt;strong&gt;'));
});

test('every note is reachable by keyboard and by find-in-page once opened', () => {
  // Native <details>/<summary> is the whole reason this needs no JS; a
  // div-and-click reimplementation would lose both.
  const html = panelNote('Lead.', '<p>Detail.</p>');
  assert.match(html, /<details[^>]*>\s*<summary>/);
});
