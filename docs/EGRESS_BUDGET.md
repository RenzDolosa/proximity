# Egress budget

**Purpose:** a per-source bytes/hour budget for this project, so a change that
affects egress can be checked against a number instead of argued about.

**Status:** the per-source figures are *estimates derived from reading the
client* — request rates are exact (they are constants in the source), response
sizes are not. The one measured input is the total: **~0.025 GB/hour**, the
user's own figure from the Supabase usage page.

**Quota:** 5 GB/month, Free plan. Uncached and cached egress have separate 5 GB
allowances; essentially all of this project's traffic is uncached (PostgREST
responses), so the 5 GB that matters is the uncached one.

---

## 1. The number to beat

| | |
|---|---|
| Measured | 0.025 GB/hour |
| Working day | 18 hours → **0.45 GB/day** |
| Month (31 days) | **13.95 GB** |
| Quota | 5 GB |
| Overshoot | **2.8×** |

Load at the time of measurement: 10 users, 3 of them active scanner kiosks.

Target with headroom: **≤ 3.5 GB/month** = 0.113 GB/day = **6.3 MB/hour**. That
leaves room for a busy month, an extra kiosk, or a day of heavy Employee Manager
use without a quota surprise.

## 2. Where it was going

Request rates are exact. Response sizes assume ~500 on-site employees of a
729-employee roster, and ~230 bytes of JSON per roster row (nine fields,
including a 36-char UUID and an ISO timestamp).

| Source | Per | Requests/hour | Response | **Bytes/hour** |
|---|---|---|---|---|
| **Dashboard on-site roster** | open tab | 120 (30 s) | ~70 KB | **~8.4 MB** |
| Dashboard pulse | open tab | 120 (30 s) | ~1.5 KB | ~180 KB |
| Alerts badge count | signed-in tab | 60 (60 s) | ~0.4 KB | ~24 KB |
| Scanner lookup delta | kiosk | 12 (5 min) | ~0.4 KB idle | ~5 KB |
| Scanner photo sync | kiosk | ≤30 (2 min floor) | ~0.2 KB idle | ~6 KB |
| Scan RPC | scan | — | ~1 KB | with volume |
| Realtime `scan_events` | subscriber | — | ~0.5 KB/event | with volume |
| Employee Manager roster | page visit | — | ~220 KB | with use |

**Two open Dashboard tabs ≈ 17 MB/hour on their own.** Add three kiosks, badge
polls, scans and occasional Employee Manager visits and ~25 MB/hour is fully
accounted for. The Dashboard roster was roughly 90% of the bill.

### Why the 2026-10-05 fix did not help

`get_dashboard_pulse()` returns `roster_version` =
`md5(count(*) || max(updated_at))` so the Dashboard can skip the roster when
nothing changed.

Every matched scan runs `UPDATE public.employees SET scan_logs = ...,
scan_parity_count = ...` (`trg_scan_events_append_log`), and
`trg_employees_updated_at` fires `BEFORE UPDATE` and sets `updated_at = now()`.

So `max(updated_at)` moves on **every scan**, which makes `roster_version` a
*"has anyone scanned in the last 30 seconds?"* flag. During a shift with three
active kiosks the answer is always yes, the skip never fires, and the full
roster is downloaded every 30 seconds. **The optimization worked only on a quiet
night — precisely when egress does not matter.**

A version string could never fix this, because the data genuinely did change.
One row of it. The fix is to send one row.

## 3. What changed (2026-10-06)

### `get_onsite_roster_delta()` — the Dashboard roster, incrementally

`20261006120000_onsite_roster_delta.sql`. Returns only employees whose
`updated_at` is past a cursor, each with an `on_roster` flag so the client can
upsert or drop. A busy 30-second window touches a handful of people; a quiet one
touches nobody.

`seconds_on_site` and `is_stale` are deliberately **not** returned. Both are
pure functions of `last_in_at`, and `is_stale` flipping with the clock was the
*entire* reason for the old unconditional 5-minute refetch — no data version can
observe a clock. The client derives both (`Utils/dashboard.js`'s
`deriveRosterRow`), the server returns `stale_hours` once so both halves share
one rule, and "Time on site" now ticks between polls instead of sitting frozen.

A full resync every 10 minutes is the self-heal: a cursor cannot see a
hard-`DELETE`d employee, and cannot recover alone if a laptop slept through a
stretch of changes. Rather than reason about each case, pay one full roster
every 10 minutes.

| Per open Dashboard tab | Before | After |
|---|---|---|
| Full rosters/hour | 120 | 6 (self-heal only) |
| Delta polls/hour | — | 114 × ~2 KB |
| Pulse/hour | 120 × ~1.5 KB | unchanged |
| **Roster bytes/hour** | **~8.4 MB** | **~0.65 MB** |

**~13× on the dominant path.**

### Projected total

| | Before | After |
|---|---|---|
| 2 Dashboard tabs | ~17 MB/h | ~1.3 MB/h |
| 3 kiosks + badges + scans | ~8 MB/h | ~0.5 MB/h |
| **Per hour** | **~25 MB** | **~1.8 MB** |
| **Per month (18 h × 31 d)** | **~13.95 GB** | **~1.0 GB** |

Against a 5 GB quota that is **5× headroom** — enough to absorb more kiosks,
more users, or a heavier month without revisiting this.

These are projections. §5 is how to confirm them.

### Also landed, smaller

- **2026-10-05** — scanner photo cache no longer re-downloads all 729
  thumbnails when an IndexedDB write fails (was unbounded: up to every 2 minutes
  per kiosk, ~12.5 MB each time).
- **2026-10-06** — thumbnails roughly halved (480px/q0.80 → 400px/q0.62) with
  **Settings → Offline scanner thumbnails** to re-encode the rows already
  stored. Shrinks every future full photo sync and the database at once.

## 4. Considered and rejected

- **Lengthen the Dashboard poll (30 s → 60 s).** Halves the symptom, keeps the
  defect, and makes a live operations screen less live. A 13× cut that *improves*
  the page beats a 2× cut that degrades it.
- **Drop the Employee Manager Realtime subscription.** `directory-scan-events`
  does receive a whole `scan_events` row to read two fields from it, and is
  unfiltered. But at ~0.5 KB × scans × subscribers it is well under 1 MB/day —
  real, and not worth the live scan counter. Revisit if scan volume grows an
  order of magnitude.
- **Fold the alerts badge into the pulse.** `unread_alerts` is already in the
  pulse, so on the Dashboard the separate 60-second poll is redundant. ~24 KB/h
  per tab, ~0.2 GB/month across 10 users — worth doing eventually, not now;
  fixing the 8.4 MB/h first is 350× the return.

## 5. Confirming it

The usage page's Egress figure is cumulative for the billing cycle, so the
**rate** is what to watch: note the reading, wait a measured interval during a
working shift, divide. Target **≤ 6.3 MB/hour**; expect ~1.8.

Per-endpoint attribution is in `SUPABASE_QUOTA_DECISION.md` §7 (Logs Explorer,
ClickHouse syntax). The query that settles this one:

```sql
select
  log_attributes['request.path'] as path,
  count() as requests,
  sum(toInt64OrZero(log_attributes['response.headers.content_length'])) as total_bytes
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '%roster%'
group by path
order by total_bytes desc
```

- **`get_onsite_roster` still dominant** ⇒ the migration is not applied, or a
  tab is running pre-fix JavaScript. `DashboardPage.js` latches
  `rosterDeltaUnavailable` and falls back permanently on `PGRST202`, so an
  unapplied migration looks exactly like no change at all. Check the migration
  first, then hard-reload (Ctrl+Shift+R).
- **`get_onsite_roster_delta` dominant, bytes low** ⇒ working as intended.
- **`get_onsite_roster_delta` dominant, bytes still high** ⇒ deltas are coming
  back large, meaning many employees change per 30-second window. Check whether
  something other than scanning is writing to `employees` in bulk.

## 6. Keeping this honest

Any change that adds a periodic request or widens a response belongs in the
table in §2 with its rate and size. The failure mode this document exists to
prevent is not a big mistake — it is a 30-second poll that nobody costed,
which is exactly how a 13 GB/month bill was built out of four reasonable-looking
decisions.

## 7. Related

- `SUPABASE_QUOTA_DECISION.md` — the quota deadline, plan options, and §7's
  per-endpoint attribution queries
- `LOCAL_DATABASE_ARCHITECTURE.md` — local-first architecture, which changes the
  bandwidth profile structurally rather than per-query
- `SUPABASE_EXIT_RUNBOOK.md` — staged cutover if the platform decision changes
