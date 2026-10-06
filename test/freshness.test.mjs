import test from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, markFetched, invalidate, invalidateAll } from '../JS/Utils/freshness.js';

// The gate that stops a nav click from re-downloading data this session already
// has. Getting it wrong is silent in both directions: too lenient and an admin's
// edit stays invisible, too strict and the 220 KB roster ships on every sidebar
// click, which is what this exists to stop.

const T0 = 1_000_000;

test('a key never fetched is never fresh', () => {
  invalidateAll();
  assert.equal(isFresh('x', 60_000, T0), false);
});

test('a key is fresh inside its window and stale outside it', () => {
  invalidateAll();
  markFetched('x', T0);
  assert.equal(isFresh('x', 60_000, T0), true);
  assert.equal(isFresh('x', 60_000, T0 + 59_999), true);
  assert.equal(isFresh('x', 60_000, T0 + 60_000), false); // boundary is exclusive
  assert.equal(isFresh('x', 60_000, T0 + 120_000), false);
});

// Mutations are the one thing a timestamp cannot observe, so every write path
// has to invalidate — otherwise a just-saved edit is hidden for the window.
test('invalidating forces a refetch inside the window', () => {
  invalidateAll();
  markFetched('x', T0);
  invalidate('x');
  assert.equal(isFresh('x', 60_000, T0), false);
});

test('keys are independent', () => {
  invalidateAll();
  markFetched('a', T0);
  assert.equal(isFresh('a', 60_000, T0), true);
  assert.equal(isFresh('b', 60_000, T0), false);
  invalidate('a');
  markFetched('b', T0);
  assert.equal(isFresh('a', 60_000, T0), false);
  assert.equal(isFresh('b', 60_000, T0), true);
});

// A zero or negative window must mean "always refetch". Reading it as "fresh
// forever" would silently pin a page to its first response.
test('a non-positive window always refetches', () => {
  invalidateAll();
  markFetched('x', T0);
  assert.equal(isFresh('x', 0, T0), false);
  assert.equal(isFresh('x', -1, T0), false);
  assert.equal(isFresh('x', undefined, T0), false);
  assert.equal(isFresh('x', NaN, T0), false);
});

// A laptop resuming, or an NTP correction, can move the clock backwards. A
// future timestamp must not read as fresh for the length of the skew.
test('a clock that moved backwards is treated as stale, not fresh', () => {
  invalidateAll();
  markFetched('x', T0 + 500_000);
  assert.equal(isFresh('x', 60_000, T0), false);
});

// Attendance encodes its range in the key, so changing the dates misses without
// anyone having to remember to invalidate.
test('a key carrying its parameters misses when they change', () => {
  invalidateAll();
  markFetched('attendance:2026-10-01..2026-10-06', T0);
  assert.equal(isFresh('attendance:2026-10-01..2026-10-06', 60_000, T0), true);
  assert.equal(isFresh('attendance:2026-09-01..2026-09-30', 60_000, T0), false);
});
