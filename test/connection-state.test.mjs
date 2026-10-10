import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionState, CONNECTION_LABEL, CONNECTION_BADGE } from '../JS/Utils/connectionState.js';

// The reported bug: the pill read "Online" while scans were queueing beside
// it. navigator.onLine answers "is there a network interface?", not "can we
// reach the server?" — it stays true behind a captive portal, on a dead
// router, and through a Supabase outage.

test('a failed request means offline even when the device claims to be online', () => {
  assert.equal(connectionState({ online: true, queued: 3, lastRequestFailed: true }), 'offline');
  assert.equal(connectionState({ online: true, queued: 0, lastRequestFailed: true }), 'offline');
});

test('queued scans with a working connection are syncing, not offline', () => {
  assert.equal(connectionState({ online: true, queued: 2, lastRequestFailed: false }), 'syncing');
});

test('online and nothing queued is the only fully healthy state', () => {
  assert.equal(connectionState({ online: true, queued: 0, lastRequestFailed: false }), 'online');
});

test('a device with no network is offline regardless of the queue', () => {
  assert.equal(connectionState({ online: false, queued: 0 }), 'offline');
  assert.equal(connectionState({ online: false, queued: 9 }), 'offline');
});

// A scan that reaches Supabase and is rejected (revoked card, unknown code)
// is NOT a connection problem — the server answered.
test('a server-side rejection does not read as a connection failure', () => {
  assert.equal(connectionState({ online: true, queued: 0, lastRequestFailed: false }), 'online');
});

test('defaults assume healthy, so a missing field cannot raise a false alarm', () => {
  assert.equal(connectionState(), 'online');
  assert.equal(connectionState({}), 'online');
});

test('every state has a label and a badge class', () => {
  for (const state of ['online', 'syncing', 'offline']) {
    assert.ok(CONNECTION_LABEL[state], `${state} needs a label`);
    assert.ok(CONNECTION_BADGE[state], `${state} needs a badge class`);
  }
});
