// Pure helpers for the Settings → Usage panel. No DOM, no Supabase, so the
// formatting is unit-tested (test/usage.test.mjs) rather than buried in page
// code.
//
// This file used to also carry elapsed-days / average-per-day / projected-
// cycle-total arithmetic for the billing metrics. That went with the
// `project-usage` Edge Function on 2026-10-05: Supabase exposes no usage or
// billing API (proven against the live project — every candidate path 404s
// while the token verifiably works), so there was never any cycle-accumulating
// metric for it to operate on. Database size is a *level*, not a flow — it is
// how big the database is right now, not something accumulated since the cycle
// boundary — so averaging or projecting it would be meaningless rather than
// merely unused. Deleted rather than left dormant; README.md's change log
// records the finding if it ever becomes relevant again.

// Decimal (1000) units, NOT the binary units Utils/format.js's fmtBytes uses.
// Deliberate: these numbers are read side by side with Supabase's own billing
// and database pages, which report GB decimally. Showing 7.4 GiB next to their
// 7.98 GB would look like a bug in one of the two.
export function fmtUsageBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  // Roughly three significant figures. A flat toFixed(1) renders "200.0 MB",
  // where the decimal is pure noise, while a flat toFixed(2) reads badly at the
  // top of a unit. Scaling the precision keeps the column aligned in width
  // without printing digits that carry no information.
  const decimals = v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

// Null (not 0) when there is no usable limit, so the caller can omit the
// percentage entirely rather than render a confident "0%".
export function fmtPercent(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round((value / limit) * 100);
}
