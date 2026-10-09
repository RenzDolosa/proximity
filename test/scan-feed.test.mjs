import test from 'node:test';
import assert from 'node:assert/strict';
import { feedTone } from '../JS/Utils/scanTone.js';

// Colour carries the signal at distance, so getting it wrong is worse than
// having none: a red row on a normal IN would send someone to check nothing.

test('direction drives the colour of a matched scan', () => {
  assert.equal(feedTone({ result: 'matched', direction: 'in' }), 'feed-in');
  assert.equal(feedTone({ result: 'matched', direction: 'out' }), 'feed-out');
});

test('anything that did not match reads as a problem, whatever its direction', () => {
  for (const result of ['unmatched', 'inactive_card', 'inactive_employee', 'unassigned_card']) {
    assert.equal(feedTone({ result, direction: 'in' }), 'feed-bad', result);
    assert.equal(feedTone({ result }), 'feed-bad', result);
  }
});

// An offline row is classified locally and may reach the feed before the
// server has confirmed the direction. Defaulting to IN rather than to the
// alarm colour keeps a queued scan from looking like a failure.
test('a matched scan with no direction yet is not shown as a failure', () => {
  assert.equal(feedTone({ result: 'matched' }), 'feed-in');
  assert.equal(feedTone({ result: 'matched', direction: null }), 'feed-in');
});
