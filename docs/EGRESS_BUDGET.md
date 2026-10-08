# Egress budget

**Purpose:** a per-source bytes/hour budget for this project, so a change that
affects egress can be checked against a number instead of argued about.

**Status:** §2's per-source figures are *estimates derived from reading the
client* — request rates are exact (they are constants in the source), response
sizes are not. The original measured input was the total: **~0.025 GB/hour**,
from the Supabase usage page.

**§2b carries the first direct measurement** (2026-10-07, 24 hours of
`edge_logs`). Read it before trusting §2: it confirms some estimates, closes one
hypothesis, and establishes that **byte totals from `edge_logs` cannot be used
at all** — only 13% of responses report a size.

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
| Attendance report | page visit | — | varies with range | with use |

**Two open Dashboard tabs ≈ 17 MB/hour on their own.** Add three kiosks, badge
polls, scans and occasional Employee Manager visits and ~25 MB/hour is fully
accounted for. The Dashboard roster was roughly 90% of the bill.

## 2b. Measured, 2026-10-07 (24 hours of `edge_logs`)

The first direct look, taken *after* every fix below had shipped. Read it as
evidence about the system's current shape, **not** as a before/after comparison —
see "What this cannot tell us".

### Byte totals from `edge_logs` are unusable

```
total_requests: 7,794 · with_content_length: 1,030 · pct_measurable: 13.2%
```

Compressed and chunked responses omit `response.headers.content_length`, so any
`sum()` over it is roughly an eighth of reality. The symptom is obvious once
seen: `scan_proximity_code_compact` averages "18 bytes" across 3,787 calls.

**Use request counts from these logs, and take byte volume from the usage page.**
§5's attribution query is still valid for *ranking* endpoints by traffic; its
absolute numbers are not.

### Request volume

| Path | Requests/24h | Reading |
|---|---|---|
| `scan_proximity_code_compact` | **3,787** | the real workload |
| `get_scanner_offline_cache_delta` | 774 | 3 kiosks ≈ every 5.5 min — correct |
| `storage/scan-sounds/*` | 1,084 | 304s, see below |
| `get_unread_alert_count` | 543 | badge polling |
| `/rest/v1/profiles` | 207 | `loadProfile()` on auth events |
| `get_alerts` | 184 | |
| `get_scanner_offline_photo_updates` | 156 | 3 × 48 ≈ every 30 min — **no runaway** |
| `/auth/v1/token` | 119 | token refresh |
| `get_dashboard_pulse` | **7** | |
| `get_onsite_roster_delta` | **7** | |
| **`get_onsite_roster`** | **0** | the old full-roster RPC is never called |

Scan volume follows the working day in Manila time (UTC+8): 472 at 07:00
(arrival), ~330/hr through the morning, 258 at noon, 455 at 18:00 (departure),
zero between midnight and 04:00. The shape is sane; nothing is polling at night.

### Closed: scan sounds are not an egress source

1,084 Storage requests a day for files up to 79 KB looked alarming. It is not:

| Path | Requests | Bytes logged | File size |
|---|---|---|---|
| `scan-sounds/matched-in` | 604 | 81,354 | 81,354 |
| `scan-sounds/matched-out` | 446 | 50,991 | 50,991 |

Total transferred equals **exactly one file** in each case — 603 of 604 requests
were `304 Not Modified`. `sw.js`'s cache-first-with-revalidate is doing its job.

### Confirmed

- **No tab is running pre-fix JavaScript.** `get_onsite_roster` has zero calls,
  so `DashboardPage.js`'s `PGRST202` fallback never fires anywhere.
- **The photo-sync leak is not occurring.** 156 calls matches the 30-minute timer
  across 3 kiosks exactly; a failing IndexedDB write would show hundreds.
- **Thumbnail recompression worked.** `employees.photo_thumb_b64` went
  12.5 MB → **5,755 kB** across 716 rows (avg 8,231 stored bytes). Projected
  "roughly half"; measured **54%**.

### Corrected

**No employee has a photo without a kiosk thumbnail.** The 2026-10-06 diagnosis —
that a 2.5-second Drive-thumbnail timeout had left rows with `photo_file_id` set
and `photo_thumb_b64` NULL — measured **zero** such rows. 716 have both, 39 have
no photo at all (those correctly show initials everywhere). Employees appearing
without a photo on a kiosk are almost certainly in that 39. The `backfill_thumb`
repair built for it is a reasonable safety net but was not the cause.

### What this cannot tell us

**Whether egress fell.** This window postdates every fix *and* contains almost no
Dashboard use — 7 pulse calls, about one hour out of twenty-four. The claim in §2
that the Dashboard roster was ~90% of the bill is neither confirmed nor refuted
here: there was nothing for the fix to save. If the original 0.025 GB/hour came
from tabs left open all shift, the fix matters enormously; if it came from
something else, that something is still unidentified.

`edge_logs` also cannot see **Realtime WebSocket traffic** at all, which is a
standing blind spot for any conclusion drawn from it.

**The usage page remains the only ground truth.** §5.

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

These are projections and **remain unconfirmed**. The 2026-10-07 measurement
(§2b) found the Dashboard open for about one hour in twenty-four, so the "2
Dashboard tabs" row had nothing to measure. What it did confirm is that
`get_onsite_roster` is never called — the delta is live everywhere — so the
mechanism is in place even where the saving is not yet demonstrated. §5 is how to
settle it.

### Nav clicks and Alt-Tab no longer refetch (2026-10-06)

The router calls a page's render function on every sidebar click, and each one
refetched unconditionally. Flicking between items re-downloaded the same rows —
~220 KB per Employee Manager visit, a whole attendance report per Attendance
visit. `JS/Utils/freshness.js` gates those on a 60-second window: the page paints
from the rows already in memory and only goes to the network once they are
actually old.

- **Mutations invalidate explicitly**, since a timestamp cannot observe a write.
  Every Employee Manager write path goes through `reloadDirectory()`, which
  invalidates before rendering, so an edit is never hidden by the window.
- **Attendance keys on its range** (`attendance:<from>..<to>`), so changing the
  dates misses naturally — *and* checks `loadedRange`, because `rowsCache` holds
  only one report: A → B → A inside the window would otherwise find key A fresh
  while the cache still held B. The Run button always forces.
- **Dashboard's Alt-Tab handler** now respects `REFRESH_MS` instead of firing on
  every flick away and back, so returning lands on the cadence the page would
  have had if it had stayed visible.

**Employee Manager's photos are Google Drive, not Supabase.** They cost page
speed and the kiosk's connection, never the 5 GB quota — and the Service Worker
photo cache was removed on 2026-09-18, so they rely on the browser's HTTP cache
alone. `loading="lazy"` on those `<img>`s means a repaint only re-requests rows
actually on screen.

### Also landed, smaller

- **2026-10-05** — scanner photo cache no longer re-downloads all 729
  thumbnails when an IndexedDB write fails (was unbounded: up to every 2 minutes
  per kiosk, ~12.5 MB each time).
- **2026-10-06** — thumbnails roughly halved (480px/q0.80 → 400px/q0.62) with
  **Settings → Offline scanner thumbnails** to re-encode the rows already
  stored. Shrinks every future full photo sync and the database at once.

## 4. Considered and rejected

### Were the `unknown_card_scan` alerts the cause?

Asked 2026-10-06, with 786 rows in `alerts`, nearly all of them unrecognised
cards. **No — about 1% of quota.** The arithmetic:

| Source | Rate | Size | Monthly |
|---|---|---|---|
| Alerts page visit | on demand | ~45 KB (capped at 100 rows) | ~28 MB at 20 visits/day |
| Unread badge count | 60/hour per signed-in tab | ~0.4 KB with overhead | ~18 MB at 3 tabs × 8 h |
| The unmatched scan itself | ~79/day | ~0.3 KB | ~0.7 MB |

`get_alerts()` is capped at 100 rows and the page has no auto-refresh, so the
table growing to 786 — or 7,860 — does not change what any request costs. Alert
*volume* is an operational problem, not a bandwidth one.

It is still worth fixing, for a better reason: at 786 alerts and a permanent
"9+" badge, the Alerts feature has stopped carrying signal. Fixed at the source —
see §3's entry on implausible scan input.



### Moving `scan_events` / `scan_logs` into Google Drive as JSON files

Asked 2026-10-06: store scan history in Drive as `<name>.jsonb`, mirroring the
employee-photo filename convention, to cut egress and Log Ingestion.

**Rejected.** The instinct — get the big append-only dataset out of the metered
place — is sound, but it is aimed at the wrong resource, and the move would make
three things worse.

- **Log Ingestion is unrelated to application tables.** It measures platform
  observability volume: Postgres log lines, API/edge logs, auth logs. Writing a
  `scan_events` row generates no log ingestion beyond the one request line for
  the call that wrote it. The driver actually under this app's control is
  **`log_min_duration_statement = 200`** on `anon`/`authenticated`/`service_role`
  (see Supabase/README.md → Query performance): every statement at or over 200 ms
  is written to the Postgres log *with its full statement text*. Raising that
  threshold, or resetting it once a performance investigation is finished, is the
  direct lever. Moving table data to Drive does not touch it.
- **`scan_logs` already costs almost no egress.** It is deliberately never sent
  to the client in bulk: excluded from `DIRECTORY_COLUMNS`, excluded from the
  scanner offline cache, and `get_onsite_roster_delta()` returns only the
  `last_in_at` / `last_scanner_id` it extracts server-side from `scan_logs -> -1`.
  `ScanLogModal` fetches one employee's log on demand. So this is a **database
  size** lever, not an egress one — and size relief already exists
  (`archive_old_scan_events()`, `trim_employee_scan_logs()`).
- **A file cannot be queried, and that is fatal.** The on-site roster, attendance
  report, IN/OUT direction and Dashboard all filter and aggregate scan history
  *server-side*. A per-employee JSON blob in Drive can only be fetched whole, so
  building the roster would mean ~729 Drive fetches instead of one SQL query. And
  egress would **rise**: a browser cannot read Drive cross-origin (the same
  opaque-response wall that sank the bulk photo prefetch, README 2026-09-18), so
  the bytes must route through an Edge Function — and the function→client leg is
  billed Supabase egress regardless of where the data came from.
- **It breaks the transaction that keeps IN/OUT correct.** A scan today is one
  transaction: insert `scan_events` → `trg_scan_events_append_log` appends to
  `scan_logs` → increments `scan_parity_count`. Split across Postgres and Drive, a
  partial failure leaves counter and log disagreeing, which **flips IN/OUT
  direction** for that employee — precisely the failure the 2026-10-01
  `scan_parity_count` work exists to prevent. Drive offers no transaction to
  enlist in.
- **It is an access-control audit trail.** Drive gives no RLS, no referential
  integrity, a single OAuth refresh token as the entire access boundary, and
  link-sharing exposure if one setting slips. `scan_events` has
  `scan_events_select_scope`. Downgrading the record of who entered which door
  and when is the wrong place to economise.

**Instead:** for size, the archival and trim jobs already running. For egress,
§3. For structural relief, `LOCAL_DATABASE_ARCHITECTURE.md` — keeping Postgres as
Postgres on a LAN removes the traffic by moving the *queries*, not by moving the
data somewhere that cannot answer them.



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

**Do not substitute the Logs Explorer for this.** §2b measured only 13% of
responses carrying `content_length`, so log-derived byte totals understate
reality by roughly 8×, and Realtime WebSocket traffic never appears in
`edge_logs` at all. Logs rank endpoints by traffic; only the usage page counts
bytes.

Per-endpoint attribution is in `SUPABASE_QUOTA_DECISION.md` §7 (Logs Explorer,
ClickHouse syntax). The query that settles this one — read the `requests` column,
not `total_bytes`:

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
  *(Measured 2026-10-07: zero calls. This failure mode is not occurring.)*
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
