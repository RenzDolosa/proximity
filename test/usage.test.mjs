import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtPercent, fmtUsageBytes } from '../JS/Utils/usage.js';

// The avg-per-day / projected-cycle-total cases that used to live here went
// with the `project-usage` Edge Function on 2026-10-05. Supabase publishes no
// usage or billing API — proven against the live project, where every
// candidate path returned 404 while the token verifiably worked — so there is
// no cycle-accumulating metric left for that arithmetic to operate on.
// Database size is a level, not a flow, and averaging it would be meaningless.
// README.md's change log has the probe output.

// Decimal units on purpose — these sit next to Supabase's own pages, which
// report GB decimally. Binary units would look like a bug in one of the two.
test('bytes are formatted decimally to match the Supabase dashboard', () => {
  assert.equal(fmtUsageBytes(7.978e9), '7.98 GB');
  assert.equal(fmtUsageBytes(5e9), '5.00 GB');
  assert.equal(fmtUsageBytes(1.5e6), '1.50 MB');
  assert.equal(fmtUsageBytes(999), '999 B');
  assert.equal(fmtUsageBytes(1000), '1.00 KB');
});

// Precision scales so the column stays a readable width without printing
// digits that carry no information.
test('precision scales with magnitude rather than being flat', () => {
  assert.equal(fmtUsageBytes(5e7), '50.0 MB');    // <100 -> one decimal
  assert.equal(fmtUsageBytes(2e8), '200 MB');     // >=100 -> none
  assert.equal(fmtUsageBytes(12.345e9), '12.3 GB');
});

// A missing value must read as unknown, never as a confident zero — "0 B" of
// database would be a lie, "—" is the truth.
test('unusable input renders as a dash, not as zero', () => {
  assert.equal(fmtUsageBytes(null), '—');
  assert.equal(fmtUsageBytes(undefined), '—');
  assert.equal(fmtUsageBytes(NaN), '—');
  assert.equal(fmtUsageBytes(-1), '—');
});

test('percentages are omitted rather than faked when there is no limit', () => {
  assert.equal(fmtPercent(35e6, 524e6), 7);
  assert.equal(fmtPercent(1, 0), null);
  assert.equal(fmtPercent(1, null), null);
  assert.equal(fmtPercent(null, 100), null);
});
