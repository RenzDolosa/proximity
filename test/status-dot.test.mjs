import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statusDotHTML, STATUS_DOT_HEADER, STATUS_DOT_STATES,
  accountState, accountStateLabel, ACCOUNT_ACTIVE_WINDOW_MS,
} from '../JS/Components/StatusDot.js';

const now = Date.UTC(2026, 9, 24, 12, 0, 0);
const ago = (ms) => new Date(now - ms).toISOString();
const MIN = 60000;
const HOUR = 60 * MIN;

test('a dot is never colour alone', () => {
  // Users & Roles and Scanner Analytics both show a 9px dot and nothing else.
  // Without words attached it is unreadable to anyone who cannot separate the
  // two colours, and ambiguous to everyone when the row is stacked on a phone.
  const html = statusDotHTML('online', 'Signed in 8 min ago');
  assert.match(html, /title="Signed in 8 min ago"/);
  assert.match(html, /aria-label="Signed in 8 min ago"/);
  // data-label, not a fixed "Status": .table-as-cards renders a stacked cell's
  // label from attr(data-label), so this is what makes the dot legible there.
  assert.match(html, /data-label="Signed in 8 min ago"/);
});

test('an unrecognised state degrades to unknown rather than emitting a bogus class', () => {
  for (const bad of ['OFFLINE', 'busy', '', null, undefined, 42]) {
    assert.match(statusDotHTML(bad, 'x'), /status-dot-unknown/);
  }
  for (const good of STATUS_DOT_STATES) {
    assert.match(statusDotHTML(good, 'x'), new RegExp(`status-dot-${good}\\b`));
  }
});

test('the header is blank but still announced', () => {
  // A visible column title would be wider than the dot it labels; a screen
  // reader still needs to know what the column is.
  assert.match(STATUS_DOT_HEADER, /aria-label="Status"/);
  assert.ok(!/>[^<]+</.test(STATUS_DOT_HEADER), 'header must render no text');
});

test('an account is active when it signed in inside the window', () => {
  assert.equal(accountState({ is_active: true, last_sign_in_at: ago(8 * MIN) }, now), 'online');
  assert.equal(accountState({ is_active: true, last_sign_in_at: ago(ACCOUNT_ACTIVE_WINDOW_MS - MIN) }, now), 'online');
  assert.equal(accountState({ is_active: true, last_sign_in_at: ago(ACCOUNT_ACTIVE_WINDOW_MS + MIN) }, now), 'offline');
});

test('disabled beats recency, and never-signed-in is its own state', () => {
  // A disabled account that signed in a minute before being disabled must not
  // read as green: the dot answers "can this account be used".
  assert.equal(accountState({ is_active: false, last_sign_in_at: ago(MIN) }, now), 'disabled');
  assert.equal(accountState({ is_active: true, last_sign_in_at: null }, now), 'unknown');
  assert.equal(accountState({ is_active: true, last_sign_in_at: 'nonsense' }, now), 'unknown');
  assert.equal(accountState(null, now), 'unknown');
});

test('the label states the real elapsed time, not the window', () => {
  // The dot is coarse by design (12 hours). The words must not be, or the
  // reader infers a precision the signal does not have.
  const label = (ms) => accountStateLabel({ is_active: true, last_sign_in_at: ago(ms) }, now);
  assert.equal(label(30 * 1000), 'Signed in just now');
  assert.equal(label(8 * MIN), 'Signed in 8 min ago');
  assert.equal(label(3 * HOUR), 'Signed in 3h ago');
  assert.equal(label(3 * 24 * HOUR), 'Signed in 3d ago');
  assert.equal(accountStateLabel({ is_active: false }, now), 'Account disabled');
  assert.equal(accountStateLabel({ is_active: true, last_sign_in_at: null }, now), 'Never signed in');
});
