# Supabase

Reference material for the live Supabase project this app talks to
(`proximity`, `kjwttqmbcjvkivgmwuev`). The actual schema, RLS policies, and
Edge Function source live in the Supabase project itself — nothing here is
deployed *from* this repo (yet). This folder is where that should move to
once you want it version-controlled, e.g. via:

```
supabase login
supabase link --project-ref kjwttqmbcjvkivgmwuev
supabase db pull          # writes a migration under Supabase/migrations/
supabase functions download proximity-scan --project-ref kjwttqmbcjvkivgmwuev
supabase functions download admin-users --project-ref kjwttqmbcjvkivgmwuev
supabase functions download upload-employee-photo --project-ref kjwttqmbcjvkivgmwuev
```

## Tables

| Table                       | Purpose                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`                   | One row per login account (`auth.users` 1:1). `role` = `admin` / `manager` / `viewer`. `access_scope` = `all` / `employee_manager` / `scanner` — which sections the account can open at all. `is_active` — soft-disable; checked at boot, force signs out if false or missing. |
| `employees`                  | Master employee record. Requires `employee_code` **and** `proximity_card_id` (NOT NULL + unique — every employee has exactly one card). `status` = `active`/`inactive`/`suspended`/`resigned`. Revoking an assigned proximity card updates this status and appends it, plus any additional remarks, to `remarks_log` in the same database transaction. `scan_logs` jsonb — append-only, written by `trg_append_scan_log` on every matched scan, and trimmed of entries older than 180 days by `trim_employee_scan_logs()` on a daily schedule (added 2026-10-01; see that function's entry and the change log). `scan_parity_count` integer (added 2026-10-01) — a durable, only-ever-incrementing counter that `trg_append_scan_log()` now reads for IN/OUT parity instead of `jsonb_array_length(scan_logs)`, so trimming `scan_logs` can never shift any future scan's direction; backfilled at migration time from each employee's count then, and never decreased afterward, including by the trim job. `remarks_log` jsonb — append-only notes, written via `add_employee_remark()` and the card-revocation RPC. `photo_url` / `photo_file_id` — Drive-hosted photo; `photo_file_id` changes to a fresh UUID on every replace (see Edge Functions below). `photo_thumb_b64` — small base64 thumbnail (added 2026-09-18), fetched server-side by `upload-employee-photo` at upload time; format is whatever Drive's `/thumbnail` endpoint returns (PNG or JPEG, not always JPEG despite this column's original 2026-09-18 write-up assuming so — client-side callers now sniff the real format rather than trusting a hardcoded label, see root `README.md`'s 2026-09-19 change log entry); feeds the offline Scanner's `offlineAvatarHTML()` with zero network requests — see "Offline scanning" below. |
| `proximity_cards`             | Standalone card inventory. Does **not** require an employee — a card can be issued and sit unassigned until linked from Employee Manager. `is_active` tracks whether the card is usable; optional `revoke_reason` stores additional remarks, while an assigned employee's selected status is recorded on the employee and in `remarks_log`. |
| `scan_events`                 | FK to `employees` and `proximity_cards`. One row per scan of a **recognised** card: `matched`, `inactive_card`, `inactive_employee`, or `unassigned_card`. Scans of a code that matches no card (`unmatched`) are **not stored** — `scan_proximity_code()` skips the insert (`if v_result <> 'unmatched'`), so `unmatched` rows never exist today even though the column's vocabulary allows it. (This file previously said every attempt was logged; corrected 2026-09-28 against the live function body. Whether to start storing them is a product decision — it means unbounded inserts from junk scans — not something a docs fix should decide.) Direction (IN/OUT) is **not a column here**: `trg_append_scan_log()` derives it from the parity of the employee's `scan_logs` length at insert time and stores it only in `employees.scan_logs`. |
| `scan_events_archive`        | Added 2026-09-30. Same shape as `scan_events`, minus foreign keys (deliberately — see below) plus `archived_at`. Rows older than 180 days are moved here by `archive_old_scan_events()` on a daily `pg_cron` schedule, so `scan_events` itself stays small as it accumulates (10,368 rows after 3 days live — see root `README.md`'s change log). Not a soft-delete: nothing is lost, `get_all_scan_events()` reads both tables so an admin's date-range export still reaches old rows. No FK to `employees`/`proximity_cards` (unlike `scan_events`, which cascades on delete) — an audit trail that disappeared when its parent row did would defeat the point of archiving it. Same read policy as `scan_events` (`is_admin() OR can_view_scanner()`); no write policy at all, since only `archive_old_scan_events()` (`SECURITY DEFINER`) ever writes here. |
| `employee_directory` (view)  | Employee joined to required card + scan totals, for the Employee Manager grid. Runs `SECURITY DEFINER` so scanner-only / restricted roles still see joined rows under RLS. Read by `JS/Models/EmployeesModel.js#listDirectory`. |
| `scan_feed` (view / function) | `get_scan_feed()` — `SECURITY DEFINER` function (originally a plain view, which silently dropped employee joins for scanner-only accounts under invoker RLS; replaced for that reason). Read by `JS/Models/ScanEventsModel.js#recentFeed`, which since 2026-10-03 calls `get_scan_feed_compact()` (no thumbnails, no proximity codes) instead. |
| `audit_log`                   | Append-only — RLS enabled with exactly one policy (`audit_log_select_admin`, `SELECT` only, `is_admin()`); no INSERT/UPDATE/DELETE policy exists at all, so nothing can write to it directly via PostgREST regardless of role. One row per destructive or permission-changing action: `actor_id`/`actor_name`, `action`, `entity_type`/`entity_id`, `detail` jsonb. Written only via `log_audit_event()` (`SECURITY DEFINER`, bypasses the table's own RLS the way every writer function here does), never a direct insert. See "Audit log" below. |

Relationship direction: `employees.proximity_card_id → proximity_cards.id`.

## Storage

| Bucket | Purpose |
| --- | --- |
| `scan-sounds` | Public bucket, 5 fixed **extension-less** object keys: `matched-in`, `matched-out`, `card-revoked`, `unmatched`, `unassigned-card`. Uploaded/replaced from the **Settings** page (`JS/Features/Settings/SettingsPage.js` → `JS/Models/ScanSoundsModel.js`) by admins and by managers whose `access_scope` covers Scanner (see Permission model below); played back from `JS/Features/Scanner/StandaloneScanner.js` and `TestScanPage.js` via `JS/Utils/scanSounds.js`. |

Fixed keys + `upsert: true` on upload mean "replace" always overwrites the
same object — no orphaned old file across a format change (mp3 → wav
etc.), unlike the Drive photo flow which has to track and delete an old
file id explicitly. `contentType` is set from the uploaded file's own
`file.type` at upload time (not inferred from a file extension, since
there isn't one), so `<audio src>` playback works purely off the
`Content-Type` response header. `file_size_limit` is 5MB;
`allowed_mime_types` covers the common audio formats
(`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`, `audio/aac`).

Storage RLS on `storage.objects` (four policies, `bucket_id = 'scan-sounds'`):
insert/update/delete require `public.can_manage_scan_sounds()` (admins, and
managers whose `access_scope` is `all` or `scanner`); select is open to any
`authenticated` caller (needed for `list()`/`getPublicUrl()` from within
the app — this already covered Viewers before the Settings capacity panel
existed to use it). The bucket's own `public = true` flag is what lets the actual
audio bytes be fetched with **no auth at all** at playback time — that's
independent of the `storage.objects` RLS policies above, which only gate
the authenticated Storage API calls (list/upload/remove), not the public
object-serving endpoint.

Client-side cache-busting: the object path never changes on replace
(same upsert path), so `JS/Utils/scanSounds.js` appends
`?v=<object's updated_at>` to the public URL — same reasoning as
`avatarHTML()`'s `cb` param for employee photos, otherwise a browser that
already fetched `matched-in` once could keep playing the old clip after
an admin swaps it out.

## RPC

- **`get_dashboard_stats(p_window_hours default 16)`** — one jsonb object for
  the Dashboard: `on_site_count`, `stale_in_count`, `on_site[]`,
  `by_department[]`, `scans_24h`, `matched_24h`, `employees_with_open_remarks`,
  `unassigned_active_cards`, `scanners_total/online/disabled` (online = seen in
  the last 10 minutes), `unread_alerts` (null unless admin/manager). Window is
  clamped to 1..72. Gate: `is_admin()` or `can_view_employee_manager()`.
  Client: `Models/DashboardModel.js`.
- **`get_dashboard_pulse(p_window_hours default 16)`** — added 2026-10-05.
  `{ stats, roster_version }`. `stats` is `get_dashboard_stats()` minus
  `on_site` and `by_department`: the Dashboard reads neither (it derives both
  from the roster via `Utils/dashboard.js`'s `summarizeRoster()`), and
  `on_site[]` in particular is a second full copy of the roster the page was
  already downloading separately. `roster_version` is
  `md5(count(*) || max(updated_at))` over `employees` — sound as a change
  signal for `get_onsite_roster()` because that function derives entirely
  from `employees` (last `scan_logs` entry + status) and every path that can
  change it either writes a row or changes the count. The one thing it cannot
  observe is `is_stale` flipping with the passage of time, which is why
  `DashboardPage.js` also force-refetches the roster every 5 minutes
  regardless. `SECURITY INVOKER` — the wrapped function runs its own gate and
  the version subquery reads `employees` under the caller's RLS. `PUBLIC` and
  `anon` revoked.
- **`get_onsite_roster(p_stale_hours default 16)`** — every employee whose
  *last* `scan_logs` entry is an `in` (any status), oldest IN first, with
  `seconds_on_site` and `is_stale` (IN older than the window). Capped at
  10,000 rows. Gate: `is_admin_or_manager()`. The client counts only
  `status = 'active'` rows as on site, matching `get_dashboard_stats()`.
- **`get_alerts(p_limit default 100, p_include_acknowledged default false)`**
  → jsonb array (newest first, each row plus `acknowledged_by_name`; limit
  clamped 1..500), **`get_unread_alert_count()`** (returns 0 for
  non-admin/manager rather than raising), **`acknowledge_alert(p_id)`**,
  **`acknowledge_all_alerts()`** (returns how many it acknowledged). Gate:
  `is_admin_or_manager()`. Alerts are written by `raise_alert()` (e.g. kind
  `unknown_card_scan`, deduplicated by `dedupe_key`), never by the client.
  Table `alerts`: `id, created_at, kind, severity, message, detail jsonb,
  dedupe_key, acknowledged_at, acknowledged_by`. Client:
  `Models/AlertsModel.js`.
- **`get_scanners()`** → jsonb array of registry rows with 24h
  `scans_24h / matched_24h / offline_24h` (gate: `is_admin()` or
  `can_view_scanner()`); **`update_scanner(p_scanner_id, p_enabled, p_label)`**
  (admin only; `null` leaves a field unchanged, empty label clears it; writes
  a `scanner_updated` audit event). `scan_proximity_code()` enforces
  `is_enabled`: a disabled scanner's live scans raise "This scanner has been
  disabled by an administrator", but `p_offline` replays are always accepted.
  Table `scanners`: `scanner_id` (pk),
  `label`, `is_enabled`, `first_seen_at`, `last_seen_at`. Client:
  `Models/ScannersModel.js`.

- **`scan_proximity_code(p_proximity_code, p_scanner_id, p_scanned_at, p_offline)`**
  — looks up the card, resolves the linked employee, classifies the
  result, inserts a `scan_events` row (even on failure), and a trigger
  appends matched scans into that employee's `scan_logs`. Returns
  `direction` (`in`/`out`) on a matched result, derived from the parity of
  `scan_logs`'s length *before* this scan is appended (even count so far
  → `in`, odd → `out`) — a plain in/out toggle per employee, not tied to
  any real door-side sensor. `p_scanned_at` (default `now()`) and
  `p_offline` (default `false`) were added 2026-09-16 — both optional and
  backward compatible for existing callers such as the
  `proximity-scan` Edge Function.
  `p_scanned_at` lets a scan captured offline and replayed later keep its
  true original timestamp (the `trg_append_scan_log` trigger reads
  `NEW.scanned_at`, so `scan_logs` inherits the correct time too);
  `p_offline: true` tags the resulting row's `raw_payload` with
  `{"captured_offline": true}` purely for audit visibility — e.g. spotting
  that a since-revoked card was actually tapped while the kiosk was
  offline, before the cache caught up. See "Offline scanning" below.
- **`scan_proximity_code_compact(p_proximity_code, p_scanner_id, p_scanned_at, p_offline, p_include_photo)`**
  — added 2026-10-03 as a security-invoker wrapper around the live
  `scan_proximity_code()`. It delegates classification, scanner enablement,
  authorization, and writes to the existing RPC, then rebuilds the
  `employee` object from an **allowlist** (`id`, `employee_code`,
  `full_name`, `department`, `position`, `status`, `photo_url`,
  `photo_file_id`, and unresolved `remarks_log` entries only) — so
  `scan_logs`, resolved remarks, `email`, `phone` and the audit columns are
  never sent to the kiosk, and a column added to `employees` later does not
  leak into scan responses by default. The event timestamp is included.
  `p_include_photo` (default `true`, added the same day in
  `20261003083051_scan_payload_photo_split.sql`) controls whether
  `photo_thumb_b64` rides along; the standalone scanner passes `false`
  because it already holds every thumbnail locally and re-attaches the right
  one (`OfflineScanModel.withCachedPhoto()`). Measured on live data: the
  full RPC response averaged ~15.5 KB, the compact response with photo ~9.3
  KB, and without photo ~0.5 KB. Offline-queue replay also passes `false`
  since it discards the response.
- **`get_scanner_offline_cache()`** — added 2026-09-16. Returns a trimmed
  `proximity_cards` ⨝ `employees` projection (code, active flags,
  employee id/name/code/department/position, and current `scan_count` for
  direction parity) as a single `jsonb` array, for
  `JS/Models/OfflineScanModel.js` to cache client-side in IndexedDB through
  `get_scanner_offline_cache_compact()`. Same
  permission gate as the real scan RPC — deliberately trimmed to only the
  fields offline classification needs, not full employee rows, even
  though the calling roles (scanner-scope, in particular) couldn't
  otherwise `SELECT` `employees` directly at all. Did briefly also carry
  `photo_thumb_b64` (2026-09-18–2026-09-19); see
  `get_scanner_offline_photos()` immediately below for why that moved out.
- **`get_scanner_offline_cache_compact()`** — added 2026-10-03 as a
  security-invoker wrapper around the live lookup RPC. It preserves that
  RPC's card/employee fields and access checks while returning only
  unresolved remarks; the offline classifier never displays resolved ones.
  Still live and still the fallback, but no longer what the kiosk calls on
  its 5-minute timer — see `get_scanner_offline_cache_delta()` directly
  below for why.
- **`get_database_usage()`** — added 2026-10-05. Backs the database half of
  Settings → Usage. Returns
  `{ database_bytes, database_limit_bytes, tables[], measured_at }`;
  `tables[]` is the ten largest `public` relations by
  `pg_total_relation_size()`, each with `total_bytes`, `table_bytes`,
  `index_bytes` and `live_rows` (`reltuples`). `SECURITY DEFINER`, gated on
  `is_admin()` — stricter than the `can_view_settings()` its sibling Settings
  panels use, because its only caller is the admin-only Usage panel and a
  looser gate would let a Viewer read table sizes and row counts directly. The
  catalog size functions are not granted to the
  application roles, so that check is the authorization, not the role's own
  privileges. `PUBLIC` and `anon` revoked; `authenticated` and `service_role`
  granted. `database_limit_bytes` is the Free-plan 500 MB ceiling, held
  server-side so the constant is not duplicated client-side.
  **The other four metrics on that panel (Egress, Cached Egress, Log
  Ingestion, Log Query) have no database representation** — they are platform
  billing figures from the Management API, fetched by the `project-usage`
  Edge Function. Client: `Models/UsageModel.js`.
- **`get_scanner_offline_cache_delta(p_since timestamptz, p_known_digest text)`**
  — added 2026-10-05. Returns
  `{ full, digest, cursor, rows }` with rows in exactly the shape
  `get_scanner_offline_cache_compact()` produces (same field names, same
  `scan_count` source column, same unresolved-remarks-only filter), so
  `JS/Core/offlineScanning.js` needed no changes to classification at all.
  `full` is true on a first sync and whenever `p_known_digest` doesn't match
  the server's current card-roster digest; otherwise `rows` contains only
  employees with `updated_at > p_since`. The caller stores `cursor` and
  `digest` and sends both back next time.
  **Two change signals, deliberately**: `employees.updated_at` is maintained
  by `trg_employees_updated_at` and bumped by every scan (via
  `trg_append_scan_log`'s `scan_parity_count` update), so "who changed" is an
  exact timestamp question; `proximity_cards` has **no** `updated_at`, and
  its row set itself can change (issue, delete, revoke, reassign), so that
  half is covered by an md5 over `(card id, proximity_code, is_active,
  assigned employee id)` whose mismatch forces one full resync. A deletion or
  rename therefore needs no `removed[]` list the way
  `get_scanner_offline_photo_updates()` does — it can't arrive as a delta in
  the first place.
  The returned `cursor` is `now() - interval '1 minute'`, not `now()`: a row
  written by a transaction still in flight when the response was built can
  carry an `updated_at` just below a `now()` cursor and would then never be
  picked up by any later delta. One minute of re-sent overlap is a few rows;
  a missed row is a kiosk classifying against stale card/employee status.
  `SECURITY DEFINER` with the same scanner gate as the RPC it replaces;
  `PUBLIC` and `anon` revoked, `authenticated`/`service_role` granted.
  Ships with `employees_updated_at_idx` for the incremental branch's filter.
- **`get_scanner_offline_photos()`** — added 2026-09-19. Split out of
  `get_scanner_offline_cache()` above: returns a **sparse**
  `[{employee_id, photo_thumb_b64}]` array — only employees who actually
  have a thumbnail on file, not the whole roster — so the lookup RPC
  above can stay small and get refreshed every 5 minutes without a
  growing photo payload riding along on every single one of those
  refreshes. Same permission gate. This full-snapshot RPC remains for
  compatibility; the standalone scanner now uses
  `get_scanner_offline_photo_updates(p_known_photo_ids)` instead, so it
  only downloads changed thumbnails and deleted-photo IDs on its 30-minute
  refresh (`StandaloneScanner.js`).
- **`get_scanner_offline_photo_updates(p_known_photo_ids)`** — added
  2026-10-03. Accepts the kiosk's small employee-id → `photo_file_id` map
  and returns changed photo thumbnails plus IDs whose photo was removed.
  Uses `photo_file_id`, which changes on each photo replacement, to avoid
  retransmitting the full thumbnail roster when nothing changed. Same
  scanner permission gate; only `authenticated` and `service_role` can
  execute it. On first sync or a legacy cache without file IDs, it returns
  all current thumbnails.
- **`test_scan_proximity_code(...)`** — same lookup/classification logic
  (including the same `direction` preview on a matched result, added
  2026-09-15 — see change log), but never writes to `scan_events` or
  `scan_logs`. Backs the in-shell **Test Scan** page so admins/managers can
  dry-run a code, including its sound and IN/OUT badge, without polluting
  the real activity log. Does **not** take the offline-related params
  above — Test Scan has no offline support (see root `README.md`'s change
  log for why that's a deliberate scope boundary, not an oversight).
- **`test_scan_proximity_code_compact(p_proximity_code)`** — added
  2026-10-03 as a security-invoker wrapper around the live test-scan RPC.
  It removes `scan_logs` and resolved remarks from the result; when
  `scan_parity_count` is present, it also uses that durable count for the
  direction preview after old scan logs have been trimmed.
- **`revoke_proximity_card(p_card_id, p_employee_status, p_additional_remarks)`**
  — revokes the card and, if assigned, updates the employee's status and
  appends a status/remarks entry to `employees.remarks_log` atomically.
  The status must be one of `active`, `inactive`, `suspended`, or `resigned`
  for an assigned card; unassigned cards take a null status. Additional
  remarks are optional and are also saved as the card's `revoke_reason`.
  Admin/manager role and Employee Manager scope are checked server-side.
- **`get_scan_feed()`** — `SECURITY DEFINER` function that backed the Recent
  Activity feed (see `scan_feed` above). **Legacy as of 2026-10-03:** it
  returns `photo_thumb_b64` and `photo_url` on every row (~88 KB for 10
  rows on live data). It is kept only so clients deployed before
  `get_scan_feed_compact()` keep working; drop it in a follow-up migration
  once no deployed client calls it.
- **`get_scan_feed_compact(p_limit, p_scanner_id)`** — added 2026-10-03
  (`20261003083051_scan_payload_photo_split.sql`). Same permission gate
  (`is_admin() or can_view_scanner()`), same ordering and operator filter as
  `get_scan_feed()`, but returns only `id`, `scanner_id`, `result`,
  `scanned_at`, `employee_id`, `employee_name` and `direction` — the fields
  the Recent Activity row actually renders — and clamps `p_limit` to 1–100.
  No thumbnails and no proximity codes; `ScanFeed.js` resolves each row's
  photo from the kiosk's local photo cache by `employee_id`. ~2.6 KB for 10
  rows on live data (vs ~88 KB).
- **`get_all_scan_events()`** — added 2026-09-21, backs Employee Manager's
  "Export all scan logs" button (`JS/Models/ScanEventsModel.js#listAll`).
  Full scan history — every stored row across BOTH `scan_events` and
  `scan_events_archive` (unioned as of 2026-09-30, see that table's note
  above; recognised-card scans only, see the `scan_events` table note
  above; same source `get_scan_feed()` reads, just without its
  `p_limit` or the archive union — that function is "recent", this one is
  "everything, ever"), newest first, capped at 100,000 rows as a safety
  valve rather than a real limit at current volume. Gated to
  `is_admin_or_manager()` — deliberately its OWN function rather than
  `get_scan_feed()` called with a huge `p_limit`: that function is gated
  to `is_admin() or can_view_scanner()` (correct for backing the live
  feed, which scanner-only kiosk accounts must read) and is named/
  defaulted (`p_limit integer default 25`) for "recent", not "everything"
  — a full-organization export is a materially more sensitive capability,
  same tier as Import/Delete-all on the same page, so it gets its own
  purpose-built, purpose-gated function instead. `#variable_conflict
  use_column` is required on this one specifically: several of its OUT
  parameters (`proximity_code`, `scanner_id`, `result`, `scanned_at`)
  share a name with a column in the `UNION ALL` subquery that feeds it,
  which PL/pgSQL otherwise reports as ambiguous — same pragma, same
  reason, as `get_attendance_report()` below.
- **`get_scanner_performance_stats(p_days integer default 7)`** — applied
  directly to the live database in an earlier session (not through a
  committed migration) and left with no caller and no documentation until
  2026-09-26 — see the change log entry below and root `README.md`'s
  matching entry for the `Analytics/AnalyticsPage.js` page that was
  actually missing. `p_days` is clamped to `[1, 90]` server-side. Returns
  one `jsonb` object with three keys, all scoped to `scan_events` rows
  within the window:
  - `summary` — `total_scans`, and a count per `result` value (`matched`,
    `unmatched`, `inactive_card`, `inactive_employee`, `unassigned_card`;
    `unmatched` is always 0 today, see the `scan_events` table note),
    plus `offline_captured` (rows whose `raw_payload->>'captured_offline'`
    is `true` — see `scan_proximity_code()`'s `p_offline` above), `since`,
    and the clamped `days`.
  - `by_scanner` — one row per distinct `scanner_id`, with `total`,
    `matched`, `match_rate_pct`, and `last_scan_at`, ordered busiest first.
  - `daily` — one row per calendar day with at least one scan, `total`
    and `matched`, ordered oldest first.
  Gated to `is_admin() or can_view_scanner()` — the same boundary as
  `get_scan_feed()`/`get_scanner_offline_cache()`, since a scanner-scope
  account already sees every individual scan result live and this is
  just that same data aggregated, not a more sensitive capability.
- **`get_scanner_scan_details(p_days integer default 7, p_filter text default 'all', p_scanner_id text default null, p_limit integer default 500)`** —
  added 2026-09-28 (`Supabase/migrations/20260928080000_scanner_analytics_drilldown.sql`),
  the row-level twin of `get_scanner_performance_stats()`: backs the
  click-to-see-details behaviour on the Scanner Analytics stat cards and
  scanner rows (`Components/ScanDetailsModal.js`). Same gate
  (`is_admin() or can_view_scanner()`) and the same window expression
  (`now() - p_days days`, `p_days` clamped `[1, 90]`) as the stats RPC, so a
  card's number and the list it opens count the same rows (a scan that lands
  between the two calls is the only possible difference). `p_filter` is a
  closed list — `all`, `matched`, `unmatched`, `inactive_card`,
  `inactive_employee`, `unassigned_card`, `offline` (rows whose
  `raw_payload->>'captured_offline'` is `true`) — and anything else raises;
  it is compared against `scan_events.result`, never built into SQL.
  `p_scanner_id` optionally scopes to one scanner. `p_limit` is clamped
  `[1, 1000]`; every row carries `total_count`, the *uncapped* match count.
  Returns `scan_id, scanned_at, employee_name, employee_code, department,
  proximity_code, scanner_id, result, captured_offline, total_count`, newest
  first (employee columns are null for a card with no employee). Exposes
  employee names to scanner-scope accounts, which `get_scan_feed()` already
  does for the same accounts. `REVOKE`d from `PUBLIC`/`anon`, `GRANT`ed to
  `authenticated` only.
- **`get_attendance_report(p_from date, p_to date, p_tz text default 'Asia/Manila')`** —
  added 2026-09-28 (`Supabase/migrations/20260928000000_attendance_report.sql`),
  backs the Attendance page (`JS/Features/Attendance/AttendancePage.js` →
  `JS/Models/AttendanceModel.js`). One row per employee per work day:
  `employee_id`, `employee_code`, `full_name`, `department`, `work_date`,
  `first_in`, `last_out`, `in_count`, `worked_seconds`, `open_punch`,
  `anomaly`. Read-only; no schema change. How a row is built:
  - **Source of truth is `employees.scan_logs`**, not `scan_events` — that
    is the only place IN/OUT is stored (see the `scan_events` table note).
    `scan_events` is only used to find *which* employees have any matched
    scan in the window, so the JSONB expansion runs for them alone.
  - **Pairing uses the log's own sequence** (`WITH ORDINALITY` + `lead()`),
    not timestamp order: direction is assigned in insert order, so a
    backdated offline sync can carry an earlier `scanned_at` than the entry
    before it. Each `in` is paired with the very next entry if that entry
    is an `out`.
  - **A row belongs to the date of its IN, in `p_tz`** (the client passes
    the browser's zone). An OUT after midnight stays on the IN's row; the
    log is read one day past `p_to` so a shift starting on the last day
    still finds its OUT.
  - `worked_seconds` = sum of each IN→OUT gap that day (breaks scanned
    out/in are excluded). `open_punch` = at least one IN with no following
    OUT (expected while someone is still on shift, otherwise a missing
    scan). `anomaly` = an OUT timestamped before its IN.
  - **Bounds:** `p_to - p_from` must be ≤ 30 (31 days inclusive) — 723
    employees × 31 days stays under the 25,000-row cap, so the cap can't
    silently truncate a legitimate report; `p_tz` must exist in
    `pg_timezone_names`; both dates required. Violations raise.
  - **Gate:** `is_admin_or_manager()` — same as `get_all_scan_events()`,
    since this is the same per-employee scan history, aggregated. `EXECUTE`
    revoked from `PUBLIC`/`anon`, granted to `authenticated`.
  - **Known limits (inherited, not introduced here):** the IN/OUT
    alternation is per-employee parity, so one missed scan flips every later
    direction until someone corrects the log; `delete_employee_scan_log()`
    removes an entry without renumbering the stored directions of later
    ones. The report surfaces both as `open_punch`/`anomaly` rather than
    hiding them. Expanding `scan_logs` also grows with an employee's total
    history — the scheduled archival job on the roadmap keeps that bounded.
- **`archive_old_scan_events(p_older_than_days integer default 180)`** —
  added 2026-09-30 (`Supabase/migrations/20260930000000_scan_events_archival.sql`),
  backs the Settings → "Scan data archival" panel and a daily `pg_cron`
  job (`archive-old-scan-events`, `0 3 * * *`, UTC). Moves every
  `scan_events` row with `scanned_at` older than the cutoff into
  `scan_events_archive`, atomically (a single `DELETE ... RETURNING`
  feeding an `INSERT`, so a failure can't delete without archiving).
  `p_older_than_days` is floored at 90 regardless of what's passed, so
  neither a bad manual argument nor a future schedule edit can shrink the
  window below what `get_scanner_performance_stats()`/
  `get_scanner_scan_details()` (both capped at 90 days) might still need —
  only `get_all_scan_events()` has no day cap, which is why it's the one
  function below updated to read both tables. **Callable two ways**, with
  two different permission contexts: pg_cron's scheduled call has no
  PostgREST request behind it, so `auth.uid()` is null — there's no caller
  to check, so it proceeds; an admin's on-demand run from Settings is a
  real request, so `auth.uid()` is set and must belong to an admin (same
  as every other admin-only RPC here). `EXECUTE` revoked from
  `PUBLIC`/`anon`, granted to `authenticated` (the internal `is_admin()`
  check is what actually gates it for that path). Deliberately does not
  touch `employees.scan_logs` (also unbounded, also on the roadmap, but
  backs `get_attendance_report()`/`get_onsite_roster()`'s direction
  derivation — trimming it safely needs its own pass) or
  `employees.remarks_log` (39 entries total as of 2026-09-30 — not a
  growth problem yet).
- **`get_scan_archive_status()`** — added 2026-09-30, read-only, admin-only.
  Returns live/archived row counts, the oldest live row's `scanned_at`, the
  most recent `archived_at`, and (best-effort — wrapped in its own
  exception handler, since `cron.job_run_details` is pg_cron's own table,
  not something this app controls the shape of) the scheduled job's most
  recent run from `cron.job_run_details`.
- **`trim_employee_scan_logs(p_older_than_days integer default 180)`** —
  added 2026-10-01 (`Supabase/migrations/20261001041500_scan_logs_trim_job.sql`),
  backs the Settings → "Scan log trimming" panel and a daily `pg_cron` job
  (`trim-employee-scan-logs`, `10 3 * * *`, UTC — 10 minutes after
  `archive-old-scan-events` so the two don't start in the same instant).
  For every employee with a non-empty `scan_logs`, rebuilds the array
  keeping only entries whose `scanned_at` is at or after the cutoff — a
  plain filter-and-replace, not an archive-then-delete like
  `archive_old_scan_events()`, because every `scan_logs` entry carries a
  `scan_id` pointing back to a real `scan_events` row (now possibly in
  `scan_events_archive`), so nothing is lost that isn't already stored
  elsewhere. Only rewrites a row that actually shrinks — an employee whose
  oldest entry is already newer than the cutoff is left untouched. Same
  90-day floor and same two-caller permission split (pg_cron with no
  `auth.uid()`, or an admin on demand) as `archive_old_scan_events()`;
  `EXECUTE` revoked from `PUBLIC`/`anon`, granted to `authenticated`.
  Returns `employees_trimmed, entries_removed, cutoff`.
  **Requires `scan_parity_count` (added in the same change, see the
  `employees` table row above) to be safe at all** — without it, shrinking
  `scan_logs` would silently flip IN/OUT direction for every active
  employee going forward, since direction used to be derived from the
  array's own length. That column was migrated, backfilled, and verified
  (continuity for a fresh employee, an existing employee, and
  `get_scanner_offline_cache()`'s `scan_count`) before this function was
  written — see the change log entry below for the verification steps.
  Deliberately does not touch `employees.remarks_log` (40 entries total as
  of 2026-10-01 — not a growth problem yet, and unlike `scan_logs` it has
  no other copy anywhere, so trimming it for real would need its own
  archive table).
- **`get_scan_logs_trim_status()`** — added 2026-10-01, read-only,
  admin-only. Returns the total `scan_logs` entry count across every
  employee, how many employees have any entries, the largest single
  employee history, and (same best-effort pattern as
  `get_scan_archive_status()`) the trim job's most recent
  `cron.job_run_details` run.
- **`check_scanner_silence(p_silence_minutes integer default 60)`** —
  implemented 2026-10-02
  (`Supabase/migrations/20261002000000_scanner_silence_alerts.sql`;
  originally planned the day before in `scanner-silence-alerts-plan.md`,
  deleted once shipped). Backs Settings → "Scanner silence alerts" and a
  `pg_cron` job (`check-scanner-silence`, `*/15 * * * *`, UTC — every 15
  minutes, not daily like the archive/trim jobs above: a scanner outage
  is time-sensitive in a way overnight housekeeping is not). For every
  `scanners` row with `is_enabled = true` and `last_seen_at` at or before
  the cutoff, raises a `scanner_went_silent` alert via `raise_alert()`
  with `dedupe_key = 'scanner-silent:' || scanner_id` and a 180-minute
  dedupe window — re-raising the same alert every 15 minutes while a
  scanner stays silent would just be noise. `p_silence_minutes` floored
  at 15, well above `scannerState()`'s own 10-minute "online" window
  (`JS/Utils/dashboard.js`) — the two are deliberately independent
  thresholds, not the same number reused in two places; this can never
  fire for a scanner the rest of the app still displays as online. Same
  two-caller permission split as the archive/trim functions above
  (`auth.uid()` null → pg_cron, proceed; set → must be admin). `EXECUTE`
  revoked from `PUBLIC`/`anon`, granted to `authenticated`.
  **A real bug was found and fixed during this implementation, not just
  assumed correct from the plan**: both this function and
  `get_scanner_silence_status()` below originally also filtered on
  `last_seen_at is not null`, meant to exclude a scanner that "was
  provisioned but never scanned". That state is unreachable in this
  schema — `scanners.last_seen_at` is `NOT NULL` with `DEFAULT now()`,
  and `scan_proximity_code()`'s own upsert
  (`insert ... on conflict (scanner_id) do update set last_seen_at =
  now()`) is the *only* path that ever creates a `scanners` row, so a row
  literally cannot exist without a real scan having already created it.
  The check was always vacuously true; removed. Verified correct by
  actually running it (not just reading it): inside a rolled-back
  transaction, synthetic enabled/disabled/under-threshold scanner rows
  confirmed exactly one alert for the one that should have fired, and
  that calling it twice in a row produced no duplicate (dedupe working).
- **`get_scanner_silence_status(p_silence_minutes integer default 60)`**
  — implemented 2026-10-02, read-only, admin-only. Returns total/enabled
  scanner counts, how many are currently silent at the given threshold,
  and (same best-effort `cron.job_run_details` pattern as
  `get_scan_archive_status()`/`get_scan_logs_trim_status()`) the
  scheduled job's most recent run.
- **`add_employee_remark(...)`** — appends a `{remark, created_by,
  created_by_id, created_at}` entry to `employees.remarks_log`.
- **`is_admin()` / `is_admin_or_manager()`** — role helper functions used
  throughout RLS policies.
- **`can_view_settings()` / `can_manage_scan_sounds()`** — the Settings
  page's own permission checks, layered on top of `access_scope` rather
  than duplicating it (see Permission model below). Used by the
  `scan-sounds` write RLS policies and by `upload-employee-photo`'s
  `quota` action.

## Permission model (enforced via Postgres RLS, not just hidden in the UI)

Two independent dimensions, mirrored in `JS/Core/state.js`:

- **Role** (`admin`/`manager`/`viewer`) — what an account can *edit*.
- **Access scope** (`all`/`employee_manager`/`scanner`) — which *sections*
  an account can open at all. Admins always behave as full-scope.

RLS policies call `is_admin()` / `is_admin_or_manager()` /
`can_view_employee_manager()` / `can_view_scanner()`, each reading the
caller's own `profiles` row.

**Settings** (`JS/Features/Settings/SettingsPage.js`) reuses this same
`role` + `access_scope` pair rather than adding a third dimension:
- `can_view_settings()` — true for admins, or for `manager`/`viewer`
  accounts whose `access_scope` is `all`, `employee_manager`, or
  `scanner` (i.e. covers at least one Settings-relevant module). Gates
  whether the account can open Settings at all, and which of its two
  panels render (`employee_manager` scope → Employee photos panel only;
  `scanner` scope → Scan sounds panel only; `all` → both).
- `can_manage_scan_sounds()` — true for admins, or for `manager` accounts
  whose `access_scope` is `all` or `scanner`. Gates upload/replace/remove
  on the Scan sounds panel specifically — `viewer` accounts always get a
  read-only panel (still see the capacity bar and can preview) regardless
  of scope, matching the `role` axis's edit-vs-view meaning everywhere
  else in this table.
Mirrored client-side in `JS/Core/state.js` as `canViewSettings()` /
`settingsShowSounds()` / `settingsShowPhotos()` / `canManageScanSounds()`
— the client checks decide what renders, the RPC/RLS checks are what
actually enforce it if someone bypasses the UI.

**Known gotcha:** a plain view runs under the *invoker's* RLS, not the
definer's — so a view joining `employees` will silently drop rows for a
role that can't directly read `employees`, even if the view itself is
grantable. The fix used here is `SECURITY DEFINER` functions (`get_scan_feed()`)
rather than plain views, for anything that needs to join across a
table a restricted role can't see directly.

**2026-09-21 — Full RLS/RPC audit, one critical finding and fix.** An
external review raised general concerns about several tables/functions
without access to verify the live policies. Verified directly against
the live project (`pg_policies`, `pg_proc` definitions, actual grants via
`has_function_privilege`):
- **Critical, confirmed and fixed — `profiles` self-privilege-escalation.**
  `profiles_update_own_or_admin`'s RLS policy was `USING (id = auth.uid()
  OR is_admin())` with no explicit `WITH CHECK`. Per standard Postgres RLS
  semantics, an UPDATE policy with no `WITH CHECK` reuses `USING` for
  both — which only ever constrained WHICH ROW could be touched, never
  WHICH COLUMNS or VALUES. Net effect: any authenticated user, of any
  role, could call `supabase.from('profiles').update({ role: 'admin'
  }).eq('id', <their own auth.uid()>)` directly and it would succeed — a
  `viewer` account could self-promote straight to `admin`, entirely
  bypassing the app's UI. No trigger or other guard existed to catch
  this (`profiles` only had `trg_profiles_updated_at`). **Fixed** with a
  `BEFORE UPDATE` trigger (`prevent_self_privilege_escalation()`,
  `trg_profiles_prevent_self_escalation`) that blocks a non-admin from
  changing `role`/`access_scope`/`is_active` on any row, including their
  own — a trigger, not a `WITH CHECK` expression, because comparing
  proposed-NEW against actual-OLD column-by-column is exactly what
  triggers are for and RLS's `WITH CHECK` can't cleanly do. Explicitly
  exempts `auth.role() = 'service_role'`: `admin-users`' Edge Function
  does real role/`access_scope` writes via `auth.admin.*`, which requires
  the service-role key and therefore bypasses RLS — but triggers fire
  regardless of RLS bypass, so without this exemption the admin panel's
  own "change a user's role" feature would have broken the moment this
  landed.
- **Real, fixed — `scan_events` table was readable by ANY authenticated
  user, regardless of role.** `get_scan_feed()` (the RPC the app actually
  uses) was correctly gated by `is_admin() or can_view_scanner()` — but
  the underlying `scan_events` table's own SELECT policy was `qual:
  true`, so that RPC-level gate meant nothing: any authenticated client
  could just skip the RPC and query `scan_events` directly to read every
  scan across every employee. Confirmed via a full grep that the client
  codebase never actually does this (always goes through `get_scan_feed()`/
  `scan_proximity_code()`), so tightening it was a pure improvement with
  no legitimate access path broken — the table's SELECT policy now
  matches the RPC's own gate exactly (`is_admin() OR can_view_scanner()`).
- **Real, fixed, low-severity — two permission-helper functions
  (`can_manage_scan_sounds()`, `can_view_settings()`) were callable by
  `anon`** (unauthenticated), unlike every other helper in this table,
  which are all `authenticated`-only. Functionally harmless as found —
  both `coalesce(..., false)` on a null `auth.uid()` for anon — but
  inconsistent with the rest of this schema's lockdown for no reason.
  Revoked from `anon`/`public`, granted to `authenticated` only, matching
  everything else here.
- **Confirmed correct, no change needed:** every `SECURITY DEFINER`
  function's actual body (`add_employee_remark`,
  `delete_employee_scan_log`, `delete_unassigned_proximity_cards`,
  `resolve_employee_remark`, `revoke_proximity_card`, `scan_proximity_code`,
  `get_scan_feed`, `get_scanner_offline_cache`, `get_scanner_offline_photos`,
  and every `is_*`/`can_view_*` helper) checks authorization via
  `auth.uid()`-derived role/scope lookups, never a client-supplied
  parameter, and fails closed (`raise exception` or `coalesce(..., false)`)
  on anything unexpected. `get_scan_feed()`'s `p_scanner_id` in
  particular — flagged by the external review as worth checking — is
  confirmed to be a display filter only, not part of authorization; the
  actual gate is `is_admin() or can_view_scanner()`, independent of that
  parameter. Every function schema-qualifies its references and runs with
  `SET search_path TO 'public'` (a hardened, non-mutable value — not the
  literal empty-string convention Supabase's own docs show, but
  equivalent in effect here since `public` has no attacker-plantable
  objects; `public`'s default `CREATE` grant to `PUBLIC` was revoked at
  project setup, per Supabase's own default Postgres role setup).
- **Not fixed here, genuinely out of scope for a schema/RLS audit — flagged
  for the account owner to action directly in the Supabase Dashboard:**
  leaked-password protection (HaveIBeenPwned checking) is off in Auth
  settings. A Dashboard toggle, not something a SQL migration can reach.
- **Employee photos are public on Google Drive by design**, not a bug —
  `upload-employee-photo` explicitly sets "anyone with the link can
  view". Once a photo's Drive URL is known, Supabase RLS no longer
  governs access to it at all; that's a deliberate, pre-existing
  tradeoff for hot-linking Drive as a free photo host, not something this
  audit pass changed. Worth reconsidering only if employee photos are
  ever treated as confidential — not assumed here.
- **Follow-up review, same day: a GraphQL-hardening checklist (disable
  introspection, cap query depth/complexity, hide field-suggestion
  errors) doesn't actually apply to this project** — confirmed via
  `pg_extension`: `pg_graphql` isn't installed, so there's no GraphQL
  surface at all, let alone one with adjustable depth limits or field
  suggestions. Translated to what's real for a PostgREST+RPC API instead:
  - *Schema introspection* — PostgREST's own OpenAPI/Swagger spec at the
    API root is the actual equivalent surface (table/column/function
    shapes, not row data — RLS still gates that regardless). Confirmed
    already disabled for every role via `alter role authenticator set
    pgrst.openapi_mode to 'disabled'` (predates this entry — verified
    live, not re-applied).
  - *Unbounded response size* — no query-depth concept exists here since
    there's no client-composed nesting, only fixed foreign-key-declared
    embedding, but the underlying "one request returns everything" risk
    is real via a different path: no cap existed on rows returned by a
    single REST request. `statement_timeout=8s` (already set) guards
    against a request hanging, but not a fast query against a
    large/growing table (`scan_events`) returning an unbounded row count
    in that time. Added `pgrst.db_max_rows = 1000` — PostgREST returns
    `206 Partial Content` with a `Content-Range` header past this,
    signaling the client to paginate rather than silently truncating.
    Matches the row-count cap already planned client-side for Employee
    Manager/Proximity Cards/Users & Roles, just enforced at the DB level
    too regardless of what the client asks for.
  - *Field-suggestion/error-verbosity leakage* — PostgREST's error
    responses for a bad table/column name aren't a comparable leak to
    GraphQL's per-field "did you mean" suggestions; there's no equivalent
    setting to toggle here. The two layers that actually prevent
    schema-mapping-by-observation are the ones above: the API's schema
    listing is already unreachable (`openapi_mode=disabled`), and RLS
    means even a syntactically-valid guess against a real table/column
    still returns zero rows without proper auth — nothing further to
    change under this heading specifically.

## Offline scanning

Added 2026-09-16. Only the standalone kiosk Scanner
(`JS/Features/Scanner/StandaloneScanner.js`) has this — Test Scan is
unaffected (see its RPC entry above).

**Two separate problems, two separate mechanisms:**
1. *The app itself won't load with no network* — solved client-side only,
   by the Service Worker (`sw.js` at the repo root; see root `README.md`).
   Nothing in Postgres is involved in this half.
2. *A scan can't be classified or logged with no network* — solved by:
   - `get_scanner_offline_cache()` (see RPC section above) feeding a local
     IndexedDB copy of the card→employee lookup, refreshed opportunistically
     while online (on load, every 5 min, and right after reconnecting).
   - `get_scanner_offline_photos()` (added 2026-09-19 — see RPC section
     above and this file's change log) feeds a *separate* local IndexedDB
     cache of `employee_id -> photo_thumb_b64`, refreshed far less often
     (every 30 min, client-side — see root `README.md`). Split out of the
     lookup cache above on purpose: that one needs to stay small and
     frequent (card/employee status), while photos only change on
     re-upload and were only ever going to grow. `OfflineScanModel.js`'s
     `getCacheMeta()` merges the two back together by `employee_id`
     before anything else sees a row, so `classify()` (and everything
     downstream of it — `ScanResultCard.js`, `ScanFeed.js`) still just
     reads `photo_thumb_b64` off the row it's given, same as always. The
     client renders it directly as a `data:` URI via `offlineAvatarHTML()`
     (`Utils/format.js`) — no network request at all, online or offline:
     the thumbnail was already fetched server-side by `upload-employee-photo`
     once, at upload time (see `photo_thumb_b64`'s own change log entry,
     2026-09-18, for why that replaced an earlier Drive-prefetch approach).
   - Failed/offline scans get queued client-side (raw attempt only — code,
     scanner id, true timestamp — never a guessed result) and replayed
     **strictly one at a time, in original order** through the real
     `scan_proximity_code()` RPC once back online. Sequential replay is
     load-bearing, not just tidy: direction is derived from `scan_logs`'s
     length *at the moment each RPC call actually runs*, so two calls for
     the same employee racing in parallel could both read the same
     "before" count and both come back `in`.
   - Resync-on-reconnect no longer relies solely on the browser's `online`
     event (unreliable on some OS/browser/network combos, and easy to miss
     entirely on a backgrounded kiosk tab): a lightweight 20s poller
     (a no-op IndexedDB read when the queue is empty) and a
     `visibilitychange` listener both retry the flush independently. A
     sync that actually writes rows now also reloads Recent Activity —
     it previously only refreshed the lookup cache, so newly-synced scans
     didn't appear until something else happened to reload the feed.

**What this does *not* solve:** the lookup cache is a snapshot — it can't
see a card revoked, or a scan made on a *different* kiosk or through Test
Scan, since its last refresh. The client shows a staleness warning past
24h of no refresh but still allows scanning past that point (fail-open by
design — see root `README.md`'s change log for the reasoning and how to
flip it to fail-closed). A kiosk's Supabase session token also still needs
network to refresh (default ~1hr expiry) independent of all of the above —
offline scanning survives an outage, staying signed in through one that
outlasts the token isn't guaranteed unless that's addressed separately
(longer JWT expiry for scanner-only accounts, e.g.).

## Audit log

Admin-only, read-only, append-only (see the `audit_log` table entry
above for the exact RLS shape). `JS/Features/Audit/AuditLogPage.js`
(sidebar: **Audit Log**, admin-gated the same way **Users & Roles** is —
both client-side via `isAdmin()` and server-side, since `get_audit_log()`
itself only returns rows `where is_admin()`).

**Every writer goes through one function, `log_audit_event(p_action,
p_entity_type, p_entity_id, p_detail)`** — inserts a row with
`actor_id = auth.uid()` and `actor_name` looked up from `profiles` at
write time (so the log still reads correctly even if that person's name
or account changes later). `raise exception`s if `auth.uid()` is null,
which matters for the trigger-based callers below: a trigger firing from
something run with no request context (a service-role script, a
migration) just silently skips logging rather than erroring the whole
operation — see each trigger's own `if auth.uid() is not null` guard.

Direct callers (an RPC calling `log_audit_event()` as one more step in
what it already does):
- `revoke_proximity_card()` → `card_revoked` (`proximity_card`) — detail:
  `proximity_code`, `reason`, `employee_id`
- `resolve_employee_remark()` → `remark_resolved` or `remark_reopened`
  (`employee`) — detail: `remark_id`
- `delete_employee_scan_log()` → `scan_log_entry_deleted` (`employee`) —
  detail: `scan_id`

Trigger-based callers (react to a delete/update on the table itself,
rather than a purpose-built RPC — used where the "destructive action" is
just a plain DELETE/UPDATE statement, not its own RPC):
- `trg_audit_employee_delete` (`AFTER DELETE` on `employees`) →
  `employee_deleted` — detail: `full_name`, `employee_code`
- `trg_audit_proximity_card_delete` (`AFTER DELETE` on `proximity_cards`)
  → `proximity_card_deleted` — detail: `proximity_code`
- `trg_audit_profile_changes` (`AFTER UPDATE` on `profiles`) →
  `account_changed`, only when `role`/`access_scope`/`is_active` actually
  changed (a plain name/email edit doesn't fire this) — detail always
  includes all three as `{from, to}` pairs regardless of which one(s)
  changed; `AuditLogPage.js`'s `describeEvent()` filters to only the ones
  where `from !== to` before displaying, rather than showing "no change"
  noise for the other two.

**Security note, fixed during this feature's own build:** `log_audit_event()`
was, briefly, directly callable by any `authenticated` user (not just
admins) via `/rest/v1/rpc/log_audit_event` — the default grant a newly
`CREATE`d function gets in this project (see the 2026-09-16
`scan_proximity_code()` overload story for why that default keeps
catching new functions here). That would have let any signed-in account
insert fabricated entries into an otherwise admin-trusted audit trail.
Revoked from `public`/`authenticated`/`anon` — the three trigger
functions themselves need no direct grant at all (Postgres invokes a
trigger function via the trigger mechanism regardless of who could
`EXECUTE` it standalone), so they were locked down the same way as a
belt-and-suspenders measure, not because either gap was independently
exploitable. Confirmed via `has_function_privilege()` and a clean
`get_advisors` pass.

**Known gap, not fixed here:** `admin-users` (the Edge Function backing
Users & Roles' create/reset-password/delete) never calls
`log_audit_event()` at all. A role/access_scope/is_active change made
*through* that function still gets audited (it updates `profiles`
directly, which `trg_audit_profile_changes` reacts to independent of
which caller made the change) — but creating an account, resetting a
password, or deleting one leaves no audit trail entry today. Worth
closing if account lifecycle events need the same visibility as
everything else here.

## Query performance (slow query logging + `pg_stat_statements`)

Two separate mechanisms, two separate jobs — both scoped to this app's
own traffic, not raw instance-wide activity:

**`log_min_duration_statement = 200` (ms), set on `anon`, `authenticated`,
and `service_role`** — any statement run as one of those roles that takes
200ms or longer gets written to the Postgres log itself, viewable in the
Supabase Dashboard's Logs Explorer. This is a *role*-level setting
(`ALTER ROLE <role> SET log_min_duration_statement = 200`), not a
database- or session-level one, and that distinction matters here more
than it usually would: PostgREST connects as `authenticator` and
impersonates (`SET ROLE`) into `anon`/`authenticated` per request based
on the caller's JWT (`service_role` for Edge Functions using the service
key). Per PostgREST 11.1's "Impersonated Role Settings" — the same
pattern this project already used for `statement_timeout` (`anon`: 3s,
`authenticated`: 8s, both predate this) — a role-level `ALTER ROLE … SET`
only takes effect for a request when it's set on the **impersonated**
role. A setting on `authenticator` or `postgres` does not carry over,
which is exactly the mistake an earlier session made here (set it on
`postgres` — the role migrations/the SQL editor/MCP tooling connect as,
never real app traffic) before this entry's fix. Always `NOTIFY pgrst,
'reload config'` after changing this — PostgREST caches role config and
won't pick up an `ALTER ROLE` until reloaded.

**`pg_stat_statements`** (already enabled on this project; was already
accumulating real stats — confirmed 1,458+ rows — despite being unused
until this feature) — an in-database, SQL-queryable aggregate: per
distinct *query shape* (literal values normalized out, so the same query
with different parameters is one row), call count, total/mean/max/min
exec time, rows, and buffer cache hit counts. This is the actual data
source for "which queries exceeded a threshold, how often, how much
resource" — log text isn't something the app can turn into a dashboard,
but this view is queryable directly.

- **`get_slow_query_stats(p_threshold_ms numeric default 200, p_limit
  integer default 50)`** — admin-only (`is_admin()`). Returns query
  shapes whose **mean** exec time is at or above `p_threshold_ms` (mean,
  not max — a single unlucky slow call shouldn't flag an otherwise-fine
  query the way a consistently-slow mean does), ordered by
  `total_exec_time` (`calls × mean` — the actual cumulative database load
  a query shape causes, which differs meaningfully from "is any single
  call of it slow"). **Filtered to `userid::regrole::text = any(array
  ['anon','authenticated','service_role'])`** — raw `pg_stat_statements`
  on a managed-Postgres instance is dominated by Supabase's own internal
  housekeeping (Realtime, background workers, the SQL editor itself
  running as `postgres`), which would drown out anything actionable here;
  also excludes its own query text (`query not ilike '%pg_stat_statements%'`)
  and scopes to `current_database()`'s `dbid`. `queryid` comes back as
  `text`, not a number — Postgres bigints can exceed JS's safe-integer
  range. Backs Settings' "Query performance" panel
  (`JS/Features/Settings/SettingsPage.js`, `JS/Models/QueryStatsModel.js`).
- **`reset_slow_query_stats()`** — admin-only, calls
  `pg_stat_statements_reset()`. Instance-wide, not scoped to a threshold
  or query — the panel's own confirm-dialog copy says so explicitly
  before an admin can trigger it.

Both functions' owner (`postgres`, the role `apply_migration` runs
`CREATE FUNCTION` as on this project) is a member of `pg_read_all_stats`,
which is what lets a `SECURITY DEFINER` function read every role's
`pg_stat_statements` rows, not just its own — verified directly
(`pg_has_role('postgres', 'pg_read_all_stats', 'member')`) rather than
assumed, since Supabase's managed `postgres` role is *not* a true
Postgres superuser (`rolsuper = false`, though it does have
`rolbypassrls = true`) and superuser is the more commonly-documented way
to get this access.

Grants: revoked from `public`/`anon`, granted to `authenticated` — same
pattern as every other RPC here, verified via `has_function_privilege()`
rather than assumed.

**Verified end-to-end against live data, not just that the SQL parses:**
ran the RPC's underlying query directly and got real, immediately
actionable results — the Employee Manager directory listing
(`employee_directory` view, paginated) was averaging ~230ms across
~1,900 calls; two `proximity_cards`/`employees` listing queries were
averaging 115–160ms across similar call counts. Not investigated further
as part of this change (this feature is the *instrument* for finding
that kind of thing, not a query-tuning pass itself) — worth a follow-up
look, likely starting with whatever index(es) `employee_directory`'s
`ORDER BY full_name` is or isn't using.

## Edge Functions

- **`proximity-scan`** — for hardware/kiosk scanners that can't run the JS
  SDK. `POST { proximity_code, scanner_id }` with a Bearer JWT; calls the
  same `scan_proximity_code()` RPC server-side. `verify_jwt: true`.
- **`admin-users`** — the only path for `create` / `update` /
  `reset_password` / `delete` on login accounts, since those need the
  service-role key (`auth.admin.*`), which must never reach the browser.
  Re-checks the caller is really an admin (via their own JWT) before doing
  anything, and guards against an admin deleting their own account. Called
  from `JS/Models/ProfilesModel.js#callAdminUsers`. `verify_jwt: true`.
- **`upload-employee-photo`** — uploads an employee photo to Google Drive,
  and (a `quota` action, added 2026-09-16) reports the connected Drive
  account's storage usage/limit for Settings' Employee photos capacity
  panel. Always writes the file under a **new UUID filename** rather than
  overwriting the previous one in place — Google's thumbnail CDN caches by
  file ID, so an in-place update kept serving the stale photo. `verify_jwt: true`.
  Auth is per-action: `upload`/`delete` require `is_admin_or_manager()` (unchanged);
  `quota` only requires `can_view_settings()` since it's read-only, so a
  Viewer with Settings access can see it too. Request/response contract for
  `upload`/`delete` is otherwise unchanged, but the client
  (`JS/Models/EmployeesModel.js#uploadPhoto`) now POSTs via a raw
  `XMLHttpRequest` instead of `supabase.functions.invoke()`, purely to get
  real `upload.onprogress` events for the Employee Manager's photo
  progress bar — `invoke()` is `fetch()`-based and only resolves once the
  whole round trip finishes, same limitation noted for CSV import.
  `upload` accepts an optional `thumb_base64`/`thumb_mime_type` pair
  (added 2026-09-19) — a small (~480px) `.webp` thumbnail the client
  already generated via `Utils/image.js`'s `fileToOfflineThumbWebp()` —
  and, if present and within a sane size bound, returns it straight back
  as `thumb_b64` for the client to store as `employees.photo_thumb_b64`
  (see "Offline scanning" above). Only when the client didn't supply one
  (an older client, or the client-side conversion itself failed) does it
  fall back to fetching a Drive thumbnail **server-side** itself — the
  original mechanism this feature shipped with 2026-09-18, now at
  `sz=w480` (bumped from the original `sz=w96`, which had gone visibly
  blurry once the Scanner started displaying this thumbnail at up to
  `min(82dvh, 82dvw)` — see root `README.md`'s matching change log entry).
  That fallback fetch is bounded to a 2.5s timeout (added 2026-09-19,
  deployed as v33) — it used to run with no timeout at all, which meant a
  freshly-uploaded file without an instantly-ready Drive thumbnail (a
  real, fairly common lag) sat directly in the upload's own response
  time. Either path is best-effort: a failure (fetch timeout, or a
  client-supplied value that fails a basic size/decode sanity check) is
  logged and returns `thumb_b64: null`, never fails the upload itself
  (`url`/`file_id` are already secured by that point regardless).
  When Google itself rejects the stored OAuth credentials the function
  answers **HTTP 503** with a stable `code` (`google_reauth_required` for
  an expired/revoked refresh token, `google_client_invalid` for a bad OAuth
  client) instead of a bare 500 — access tokens renew silently on every
  call, but a dead *refresh* token can only be replaced by a human
  re-consenting once. Causes, prevention, and the 2-minute re-issue steps
  are in `functions/upload-employee-photo/README.md` → "Refresh token stops
  working?".

See `functions/proximity-scan/README.md`, `functions/admin-users/README.md`,
and `functions/upload-employee-photo/README.md` for the request/response
contracts each client-side caller relies on.

---
*Last reconciled against `Supabase:list_tables` (verbose),
`Supabase:list_edge_functions`, `storage.buckets`, and
`pg_get_functiondef()` on the live `kjwttqmbcjvkivgmwuev` project,
2026-10-02. Re-verify against those before trusting this file blindly in a
future session — schema, Storage, and functions evolve independently of
git commits here since nothing is deployed *from* this repo yet.*

### Change log (most recent first)

**2026-10-05 — `get_database_usage()` RPC + `project-usage` Edge Function (Settings → Usage)**
- New `get_database_usage()` (`20261005120000_database_usage_rpc.sql`, **not
  applied by this session — apply by hand**): returns
  `{ database_bytes, database_limit_bytes, tables[], measured_at }`, where
  `tables[]` is the ten largest `public` relations by
  `pg_total_relation_size()` with table/index split and `reltuples`.
  `SECURITY DEFINER` gated on `can_view_settings()` — the catalog functions it
  reads are not granted to the application roles, so the check is what
  authorizes it, not the role's own privileges. `PUBLIC` and `anon` revoked.
- `database_limit_bytes` is the Free-plan 500 MB ceiling, stated server-side so
  the constant lives in one place rather than being duplicated in the client.
  Update it on a plan change.
- **Only this one of the panel's five metrics is knowable from the database.**
  Egress, Cached Egress, Log Ingestion and Log Query are platform *billing*
  metrics with no database representation at all; they come from Supabase's
  Management API via the new `project-usage` Edge Function, which holds a
  Personal Access Token as a secret. That token can read and delete every
  project in the account, so it is categorically not something the browser can
  hold — full contract, setup and threat note in
  `Supabase/functions/project-usage/README.md`.
- Database size is also the only one that is a **level** rather than a flow:
  egress and log ingestion accumulate across a billing cycle and reset at the
  boundary, while database size is simply how big the database is now.
  Averaging a level over elapsed days would be meaningless, so the client shows
  no per-day or projected figure for it.
- The panel is **on demand only, never polled** — a usage monitor on a timer
  would spend the egress and log-ingestion quota it reports on. Both the Edge
  Function header and that README say so, so it does not get "improved" into a
  polling loop later.
- Edge Functions **do** auto-deploy from `main` (`deploy-supabase.yml`, on
  `Supabase/functions/**`), unlike migrations. So `project-usage` ships on
  merge, but it returns `503 not_configured` until
  `SUPABASE_MANAGEMENT_TOKEN` and `SUPABASE_PROJECT_REF` are set as secrets,
  and `get_database_usage()` must be applied manually first or the panel's
  database half errors.

**2026-10-05 — The egress migration is not applied, and nothing in CI will apply it**
- Verified: no workflow in `.github/workflows/` runs `supabase db push`,
  `migration up`, or `apply_migration`. `deploy-supabase.yml` triggers only on
  `Supabase/functions/**` and deploys Edge Functions only. **Every migration in
  this directory has to be applied by hand**, which this file's change log has
  said repeatedly and which is now load-bearing for a deadline.
- Consequence: `20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql`
  is almost certainly not live. `get_scanner_offline_cache_delta()` and
  `get_dashboard_pulse()` therefore do not exist on the project, both clients
  take their `PGRST202` fallback to `get_scanner_offline_cache_compact()` and
  the `get_dashboard_stats()` + `get_onsite_roster()` pair, and egress is still
  being spent at the pre-fix rate — ~430 KB per kiosk per 5 minutes plus the
  Dashboard's doubled roster. That matters now because the org's grace period
  for exceeding the Free-plan egress quota ends 03 Nov 2026.
  **Applying that one file is the highest-leverage action available.**
- `Supabase/local/export-project.sh` added: a read-only, complete capture of the
  live project (schema in three forms, data, `auth.users`, roles, extensions,
  all function definitions, RLS policies, triggers, live migration history,
  pg_cron jobs, realtime publication membership, storage bucket config and
  object listing, row counts). Soft-fails per step and reports failures rather
  than producing a silently partial archive. Requires the **direct** connection
  string (5432, not the 6543 pooler) and client tools **17+**.
- Its `inventory/public-functions.sql` is the fix for the drift recorded in the
  entry below: it contains the live definitions of all nine missing RPCs,
  `raise_alert()`, and the `alerts` / `scanners` tables, plus the current
  `scan_proximity_code()` that the committed baseline is behind. Diff against
  `Supabase/migrations/`, commit the gaps, then delete the matching entries from
  `test/schema-drift.test.mjs`'s allowlists.
- Reminder, unchanged and now more important: **`supabase db push` is unsafe
  against this project** until that reconciliation is done — the live history is
  missing entries for migrations that are nonetheless applied, and repo
  filenames use different version numbers than live. Apply files directly, then
  `supabase migration repair`.
- Full decision framework (quota restriction vs. project loss, the three
  options and their real costs) in `docs/SUPABASE_QUOTA_DECISION.md`; the staged
  cutover plan is `docs/SUPABASE_EXIT_RUNBOOK.md`.

**2026-10-05 — Migration drift is now a failing-CI condition, not a paragraph**
- Measured, not asserted: applying `Supabase/migrations/*.sql` in filename
  order to an empty PostgreSQL **fails**.
  `20261002000000_scanner_silence_alerts.sql` calls `public.raise_alert()` and
  reads/writes `public.scanners` and `public.alerts`; no migration in this
  directory creates any of the three. Nine client-called RPCs also have no
  file here at all — `get_dashboard_stats`, `get_onsite_roster`, `get_alerts`,
  `get_unread_alert_count`, `acknowledge_alert`, `acknowledge_all_alerts`,
  `get_scanners`, `update_scanner`, `get_scanner_performance_stats` — which is
  the same "backend shipped, UI followed later, migration never written"
  pattern this change log already records for 2026-09-28 and 2026-10-02.
- The committed `scan_proximity_code()` is also **behind live**, not merely
  incomplete: this file documents that a `scanners` row is created by that
  function's own upsert, and the baseline's copy contains no reference to
  `scanners` anywhere.
- `test/schema-drift.test.mjs` now cross-checks every `.rpc()` and `.from()`
  in `JS/` and every `public.<object>` referenced by a migration against what
  the migrations create. Today's gap is pinned in explicit allowlists
  (`KNOWN_MISSING_FUNCTIONS`, `KNOWN_MISSING_DEPENDENCIES`) so the suite stays
  green while it's paid down; **new** drift fails immediately. A staleness
  assertion means reconciling an object forces its allowlist entry to be
  deleted, so the list can't rot into noise.
- Reconciliation order, when someone picks this up: `pg_get_functiondef` the
  nine functions plus `raise_alert()`, `supabase db pull` the `alerts` and
  `scanners` tables, re-capture `scan_proximity_code()`, then repair
  `supabase_migrations.schema_migrations` (still carrying the version-number
  mismatches described in the 2026-10-03 entries) before any automated
  migration deploy. Verify each step with `Supabase/local/apply-migrations.sh`
  against a `supabase start` stack, and delete the matching allowlist entry.
- Context for why this is worth doing now rather than later:
  `docs/LOCAL_DATABASE_ARCHITECTURE.md` (branch
  `architecture/local-database-sync`) proposes per-site local PostgreSQL with
  central sync. Every phase of it begins by building the schema from this
  directory, so this is the gating work — ahead of any sync engine.
- Still true and still unfixed by this: the RPC/RLS integration suite
  `.github/AI_REVIEW.md` names as missing. RLS is the real permission
  boundary and nothing currently exercises it against a real database.

**2026-10-05 — Egress pass 3: the two unconditional whole-dataset polls**
- Pass 2 closed with "remaining egress candidates, not changed:
  `get_scanner_offline_cache_compact()` is refreshed every 5 minutes per
  kiosk and returns the whole card roster each time ... `get_dashboard_stats()`
  / `get_onsite_roster()` polling". Those candidates are the bill. Using this
  file's own recorded figures (729 employees, ~0.6 KB/employee without
  photos, `get_onsite_roster(16)` = 272 rows):
  - kiosk lookup cache: ~430 KB × 288 calls/day = **~125 MB/day per kiosk**,
    ~3.7 GB per billing cycle per kiosk, essentially all of it unchanged rows;
  - Dashboard: 2 RPCs × 2,880 polls/day per open tab, and
    `get_dashboard_stats()`'s `on_site[]` means the roster came down roughly
    twice per poll for a page that reads neither `on_site[]` nor
    `by_department[]`.
  Per-scan payloads, which passes 1 and 2 optimized hard (15,502 B → 487 B),
  are not the problem — the timers are.
- `20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql` (**not
  applied to the live project by this session — see below**) adds
  `get_scanner_offline_cache_delta(p_since, p_known_digest)` and
  `get_dashboard_pulse(p_window_hours)`, plus `employees_updated_at_idx`.
  Full contracts in the RPC section above, including why the scanner needs a
  timestamp cursor *and* a digest (`proximity_cards` has no `updated_at`) and
  why the returned cursor lags `now()` by a minute.
- Purely additive: no existing function is dropped or redefined, so an
  already-deployed client is unaffected. Both new callers detect `PGRST202`
  ("could not find the function") once and fall back to the previous RPCs for
  the rest of the page session, so a **client deploy landing before this
  migration degrades to today's behaviour rather than breaking** — important
  for the kiosk, where a lookup cache that silently stopped refreshing would
  undermine the exact thing offline scanning exists to guarantee.
- Client: `OfflineScanModel.refreshCache()` stores `{rows, syncedAt, cursor,
  digest}` and merges through the new pure `mergeLookupDelta()`
  (`JS/Core/offlineScanning.js`, 6 new cases in
  `test/offline-scanning.test.mjs`; 43 tests passing).
  `DashboardPage.js` polls the pulse and skips `get_onsite_roster()` while
  `roster_version` is unchanged, with a 5-minute forced refetch for `is_stale`
  and an always-forced one behind the Refresh button.
  `JS/Core/alertsBadge.js` stops polling while the tab is hidden.
  `EmployeesModel.listDirectory()` replaces `select('*')` with an explicit
  column list, dropping `last_scan` (a jsonb scan-log entry per employee),
  `total_remarks`, `created_at` and `updated_at`.
- **Verification status — read before trusting the numbers above.** The
  Supabase credentials in this session cover a different organization
  (`Pakyawan`, `PSP`); project `kjwttqmbcjvkivgmwuev` was not reachable, so
  **nothing here was executed, EXPLAINed, or measured against the live
  database**, and no API-log attribution was done. The estimates come from
  this file's previously recorded row counts and payload sizes. Before
  relying on this: apply the migration, confirm `get_dashboard_stats()`
  really does return `on_site`/`by_department` keys (the `-` operator is a
  no-op if not, so this is safe either way), confirm `get_onsite_roster()`
  still answers under the new client, and compare **project-filtered**
  uncached egress — the billing screenshot is still filtered to *All
  projects*, which is organization-wide and not attributable to Proximity.
- Migration-history drift called out in the 2026-10-03 entries is unchanged
  and still blocks `supabase db push` against this project; apply this file
  the same way the previous two were (directly, then
  `supabase migration repair` when the history is reconciled).

**2026-10-03 (pass 2) — remove thumbnails and unused PII from live scan/feed responses; close an `anon` grant**
- Pass 1 (below) removed `scan_logs` from scan responses, but measuring live
  data showed the thumbnail was still ~92% of what remained: a compact scan
  response averaged ~9.3 KB (~7.7 KB of it `photo_thumb_b64`), and one
  10-row `get_scan_feed()` call returned ~88 KB, because every row repeated
  the thumbnail. The kiosk already syncs all thumbnails locally and
  incrementally (`get_scanner_offline_photo_updates()`), so neither
  response needs to carry one.
- `20261003083051_scan_payload_photo_split.sql` (applied live; additive and
  backward compatible): `scan_proximity_code_compact` gains
  `p_include_photo boolean DEFAULT true` and an employee-field allowlist;
  new `get_scan_feed_compact()` (see RPC section). Adding the parameter
  changed the function signature, so the old 4-argument function is
  dropped in the same transaction and the grants re-applied — otherwise
  Postgres keeps both overloads and the new one inherits default execute
  grants (same trap as the 2026-09-16 `scan_proximity_code` overload).
- Verified against live data inside a transaction that always aborts (the
  scan RPC writes): one matched scan 15,502 B (raw RPC) → 9,259 B (compact
  with photo) → **487 B** (`p_include_photo => false`); 10-row feed 88,019 B
  → **2,630 B**. Confirmed afterwards that no `scan_events` row or
  `scan_logs` entry was left behind.
- Client: `ScanEventsModel.scan()` passes `p_include_photo: false` and
  `recentFeed()` calls `get_scan_feed_compact()`; the offline-queue replay
  also passes `false`. `OfflineScanModel.withCachedPhoto()` re-attaches the
  thumbnail from an in-memory copy of the IndexedDB photo cache and, when the
  scanned employee has a `photo_file_id` the cache lacks or holds a
  different version of (new hire, replaced photo), triggers the incremental
  photo sync immediately (throttled to once per 2 minutes, de-duplicated
  with the 30-minute timer) instead of waiting up to 30 minutes.
  Trade-off: that first scan of a brand-new photo shows initials; the next
  scan shows the photo.
- `20261003083312_revoke_proximity_card_revoke_anon.sql` (applied live):
  the Oct 3 `revoke_proximity_card(uuid, text, text)` migration revoked
  `PUBLIC` but not `anon`, and Supabase's default privileges grant `anon`
  execute directly, so the security advisor flagged it as anonymously
  callable. The function's own admin/manager check already rejected
  anonymous callers, so this was defense in depth, not an open hole. No
  `SECURITY DEFINER` function in `public` is anon-executable now. Reminder
  for every future `DROP`/`CREATE` of a function: `REVOKE ... FROM PUBLIC`
  **and** `FROM anon`.
- **Migration history drift (not fixed here):** the live
  `supabase_migrations.schema_migrations` does not contain
  `20261003025504_reduce_scan_rpc_payloads` or
  `20261003060125_revoke_card_employee_status`, although both are live
  (they were applied outside the tracked history), and the repo's older
  migration filenames use different version numbers than the live history
  (for example `20260930000000_scan_events_archival` vs live
  `20260930091040`). `supabase db push` / `migration up` against this
  project would therefore try to re-run files that already took effect.
  Reconcile with `supabase migration repair` before introducing any
  automated migration deploy. The two files added here use the live
  version numbers.
- Remaining egress candidates, not changed: `get_scanner_offline_cache_compact()`
  is refreshed every 5 minutes per kiosk and returns the whole card roster
  each time (a `scanned_since`-style incremental sync would be the next
  step, but the payload is only ~0.6 KB per employee without photos);
  `get_dashboard_stats()` / `get_onsite_roster()` polling (already paused
  while the tab is hidden); Storage and Realtime were not the main
  contributors in the sampled 24 hours of logs.

**2026-10-03 — Supabase egress investigation: reduce repeated scan payloads**
- The provided billing screenshot is filtered to **All projects**. Its
  6.34 GB total egress (about 0.01 GB cached) is organization-wide, not
  Proximity-only. The small cached share suggests most traffic was uncached,
  but the screenshot does not identify which project or endpoint
  contributed each byte.
- The committed scan RPCs used `to_jsonb(v_employee)` in every response.
  A matched scan therefore sent the employee's append-only `scan_logs` and
  resolved `remarks_log` history along with fields the scanner displays.
  The standalone scanner also re-requested its latest 10 feed rows after
  each matched scan, re-sending thumbnail data for older scans. Its
  30-minute offline-photo refresh also downloaded every employee thumbnail
  each time, even when no photo had changed.
- `20261003025504_reduce_scan_rpc_payloads.sql` omits scan history from
  both scan RPC results, retains only unresolved remarks for display,
  returns scan timestamps for the scanner feed, and corrects test-scan
  direction calculation to use `scan_parity_count` after log trimming. The
  scanner now prepends the authoritative matched result and scan timestamp
  to its feed when the server returns that timestamp, falling back to the
  existing feed request if an older RPC response is still deployed.
- Added `get_scanner_offline_photo_updates()`: it sends only changed photo
  thumbnails (based on `photo_file_id`) and removed-photo IDs after the
  first full sync. The frequently refreshed offline lookup also omits
  resolved remarks.
- Dashboard polling now pauses in hidden tabs and refreshes when a tab
  becomes visible again. It still calls both documented stats and roster
  RPCs every 30 seconds while visible; the stats contract includes an
  `on_site[]` field the page does not read, so the live function's actual
  payload and that redundant snapshot remain candidates to inspect using
  Supabase API logs / project observability.
- This repository does not auto-deploy database migrations. Apply the
  migration to the live project **before deploying the client changes**,
  select the Proximity project in Supabase Usage, then compare endpoint
  response sizes and uncached egress after the next usage refresh. Do not
  attribute the screenshot's full 6.34 GB to this project.
- The separate `proximity-scan` Edge Function still calls the legacy
  `scan_proximity_code()` RPC; its source is not tracked here. If hardware
  readers still use that endpoint, update its deployed source to call the
  compact wrapper as a follow-up.

**2026-10-02 — Implemented: proactive scanner-silence alerting (plan from 2026-10-01)**
- See the `check_scanner_silence()` / `get_scanner_silence_status()` RPC
  entries above for the full contract, the dead-code bug found and fixed
  while verifying the already-live implementation against this schema
  (not the plan's assumption about it), and how it was verified.
- **Reconciliation, same pattern as past gaps in this file**: the backend
  was already fully live on the project — function bodies, grants, and
  the `check-scanner-silence` cron job all existed — before any migration
  file or client-side code existed for it at all.
  `Supabase/migrations/20261002000000_scanner_silence_alerts.sql` is the
  first commit of any kind for this feature, written to reproduce the
  live state exactly (with the one fix above applied).
- `scanner-silence-alerts-plan.md` deleted per its own instruction, now
  that the work it described has shipped.

**2026-10-01 — Plan written (not implemented): time-limited proximity cards**
- `expiring-proximity-cards-plan.md` (repo root) proposes `proximity_cards.expires_at`
  plus a daily `pg_cron` job, `expire_proximity_cards()`, following the exact
  convention of `archive_old_scan_events()` / `trim_employee_scan_logs()`
  below. Also specifies updating `scan_proximity_code()`,
  `get_scanner_offline_cache()`, and `test_scan_proximity_code()` to treat
  a past-due `expires_at` as inactive, so an expired card can't still scan
  for up to a day while waiting on the cron sweep. No schema or function
  changes have been made yet — this entry exists purely so a future session
  querying this file's change log knows the plan exists before starting
  similar work from scratch.

**2026-10-01 — `employees.scan_logs` trimming: `scan_parity_count` first, then `trim_employee_scan_logs()` + daily `pg_cron`**
- `scan_logs` is the same shape of unbounded-growth problem `scan_events`
  was (729 employees, 12,792 entries total, max 137 on one employee as of
  this migration) but could not be solved the same way, because the
  array's *length* was load-bearing: `trg_append_scan_log()` computed each
  new scan's IN/OUT `direction` from `jsonb_array_length(scan_logs) % 2`
  at insert time, and `JS/Core/offlineScanning.js` mirrored the identical
  arithmetic client-side from `get_scanner_offline_cache()`'s `scan_count`
  field. Trimming entries out of that array, as-is, would have silently
  flipped direction for every active employee going forward the moment
  their array got shorter — no error, no crash, just a wrong badge from
  then on. `get_attendance_report()` and `get_onsite_roster()` read the
  *stored* `direction` string out of each entry rather than recomputing
  it, so they were never at risk from this — confirmed by inspecting both
  function bodies before writing anything.
- **Phase 0, shipped and verified alone first**
  (`20261001040000_scan_logs_parity_counter.sql`): new
  `employees.scan_parity_count integer not null default 0`, backfilled to
  each employee's current `jsonb_array_length(scan_logs)` so the migration
  is a no-op in effect — the very next scan computes the same direction
  the old array-length arithmetic would have. `trg_append_scan_log()` now
  reads/increments this counter instead of the array's length;
  `get_scanner_offline_cache()` now sources `scan_count` from it too —
  **the field keeps its existing name on the wire**, so
  `JS/Core/offlineScanning.js` needed zero changes. `delete_employee_scan_log()`
  deliberately left alone: it already only ever removed one entry
  (an admin-triggered, one-row event), and not touching the counter there
  means a deleted entry no longer shifts anything downstream at all —
  strictly better than before, not a regression to fix.
  - Verified directly against live data, in rolled-back transactions where
    destructive, before Phase 1 was written: backfill was exact (0
    employees where `scan_parity_count <> jsonb_array_length(scan_logs)`,
    checked across all 729); a brand-new employee inserted end-to-end
    still alternated `in, out, in` across three scans with the counter
    tracking each one; a real employee with existing history had their
    next scan continue the exact alternation their pre-migration array
    length would have produced; `get_scanner_offline_cache()`'s
    `scan_count` matched `scan_parity_count` exactly for the employees
    with the most history.
- **Phase 1** (`20261001041500_scan_logs_trim_job.sql`): new
  `trim_employee_scan_logs(p_older_than_days integer default 180)` and
  `get_scan_logs_trim_status()` — full contracts in the RPC section above
  — plus a daily `pg_cron` job (`trim-employee-scan-logs`, `10 3 * * *`
  UTC, 10 minutes after `archive-old-scan-events` so the two never start
  in the same instant). No archive table, unlike `scan_events_archive`:
  every `scan_logs` entry already points back to a real `scan_events` row
  (possibly archived since 2026-09-30), so a plain filter-and-replace per
  employee loses nothing.
  - Verified: a synthetic 400-day-old entry prepended to a real employee's
    `scan_logs` (in a rolled-back transaction) was removed by a call at
    the default 180-day window, reporting `employees_trimmed: 1,
    entries_removed: 1`, with `scan_parity_count` left exactly unchanged
    by the trim (confirming parity really is decoupled from array length
    now); an unprivileged caller is refused with `not permitted to run
    scan-log trimming`; `has_function_privilege()` confirms `anon`/`PUBLIC`
    blocked and `authenticated` allowed on both new functions; the cron
    job's `jobname`/`schedule`/`command` were read back from `cron.job`
    after scheduling.
- New Settings → "Scan log trimming" panel, same place (right below "Scan
  data archival") and pattern: total entries across every employee,
  employees with any history, the largest single history, the scheduled
  job's last run, and a "Run trim now" button. New
  `JS/Models/ScanLogsTrimModel.js`. Verified in a jsdom simulation of the
  real `SettingsPage.js` with mocked RPCs: the panel renders the status
  figures, clicking "Run trim now" calls `trim_employee_scan_logs` and
  then reloads status.
- Client-side test: `test/offline-scanning.test.mjs` gained a case pinning
  that `classifyCachedScan()`'s direction math treats `scan_count` as an
  opaque number from the cache — it has no idea whether that number came
  from array length or the new counter, which is exactly the point (suite
  is now 33).
- Deliberately not touched: `employees.remarks_log` — same call the
  `scan_events` archival pass already made for it, re-confirmed still true
  (40 entries total across 723 employees, max 3 on any one, as of
  2026-10-01). Unlike `scan_logs`, a remark has no other copy anywhere, so
  trimming it for real would need its own archive table — a different
  piece of work, not an extension of this one.
- Not done in this pass (optional, separable per the original plan): a
  `get_employee_scan_history()` RPC so `ScanLogModal.js`'s per-employee
  view spans `scan_events ∪ scan_events_archive` the way `get_all_scan_events()`
  already does, closing the one remaining gap between a single employee's
  trimmed-view history and the roster-wide export.

**2026-09-30 — Scan-data archival: `scan_events_archive` + `archive_old_scan_events()` + daily `pg_cron` schedule**
- New table `scan_events_archive`, new functions `archive_old_scan_events(p_older_than_days default 180)`
  and `get_scan_archive_status()`, `get_all_scan_events()` updated to union
  both tables. Full contracts above. Migration:
  `Supabase/migrations/20260930000000_scan_events_archival.sql`.
- `pg_cron` was not previously installed on this project —
  `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions` (its
  control functions land in a fixed `cron` schema regardless of the
  `WITH SCHEMA` target; that clause only affects the extension's own
  catalog bookkeeping, kept out of `public` so it isn't exposed to
  PostgREST). Scheduling is idempotent — the migration unschedules any
  existing job of the same name before scheduling fresh, so re-running it
  can't produce two daily jobs.
- **Real bug caught before shipping, not after:** the first version of the
  updated `get_all_scan_events()` failed with "column reference ... is
  ambiguous" — several of its `RETURNS TABLE` OUT parameter names
  (`proximity_code`, `scanner_id`, `result`, `scanned_at`) collided with
  same-named columns in the new `UNION ALL` subquery, which PL/pgSQL can't
  disambiguate on its own. Fixed with `#variable_conflict use_column`
  (same pragma `get_attendance_report()` already uses, for the same
  reason) rather than qualifying every reference by hand.
- **Verified against real data, not just that it ran without error:**
  inserted one synthetic `scan_events` row 200 days old with
  `employee_id = null` first (confirmed `trg_append_scan_log()` is a
  no-op for a null employee_id or non-`matched` result, so this couldn't
  mutate any real employee's `scan_logs`), then confirmed, in order: a
  non-admin's call is refused; an admin's call moves exactly that one row;
  it's gone from `scan_events` and present in `scan_events_archive` with
  `raw_payload` intact; `get_all_scan_events()` with a date range covering
  it returns it correctly; a normal recent-range export (4,377 rows) is
  unaffected; `get_scan_archive_status()` reports consistent counts.
  Deleted the synthetic row from the archive afterward. `get_advisors`
  (security): 34 findings, the 2 new ones being this entry's own
  functions, both matching the existing accepted
  self-checking-`SECURITY DEFINER` baseline — no regressions.
- Settings → "Scan data archival" panel (admin-only, same `isAdmin()` gate
  as "Query performance" next to it): live/archived counts, oldest live
  row, last scheduled run (best-effort, see `get_scan_archive_status()`
  above), and a "Run archival now" button for an on-demand run with the
  same 180-day default. New `JS/Models/ScanArchiveModel.js`. No new pure
  logic to unit-test (this is RPC calls + a stat panel, not a rule), so
  verified instead with a jsdom harness: panel renders, counts display,
  the button runs/restores correctly on both success and the error path.
- Deliberately out of scope, see `archive_old_scan_events()` above:
  `employees.scan_logs` and `employees.remarks_log`.

**2026-09-28 — Dashboard / Alerts / Scanner-registry RPCs now documented and consumed by the client**
- No schema change. The RPCs listed at the top of the RPC section above were
  already live; the client now has callers for them (`DashboardPage.js`,
  `AlertsPage.js`, `ScannersPanel.js`). Verified under an impersonated admin
  claim: `get_onsite_roster(16)` returned 272 rows, `get_alerts(100,false)` 16,
  `get_scanners()` 3, and the stats object carries the keys the page reads.
- **Correction to my own work this session**: I twice created a function with
  the same name as one already live (`export_scan_logs`, then a
  `get_dashboard_stats(integer, text)` overload) because I had not listed the
  live functions first; both were dropped within the same session, confirmed
  by `pg_proc`. The overload case is the exact trap already documented under
  the 2026-09-16 offline-scanner entry (a new signature creates a *second*
  function). Always list `pg_proc` before adding an RPC.
- **Still open**: the drift noted below is not closed by this — these RPCs and
  the `alerts`/`scanners` tables still have no file in `Supabase/migrations/`.
  Run `supabase db pull` before anyone runs `supabase db reset` from this
  folder.

**2026-09-28 — `get_scanner_scan_details()` added (Scanner Analytics drill-down); live/repo drift noted**
- New read-only RPC + migration file `20260928080000_scanner_analytics_drilldown.sql`
  (applied to the live project via MCP as `scanner_analytics_drilldown`).
  Full contract in the RPC section above. No table, RLS or existing-grant
  changes.
- Verified live before wiring the client: `has_function_privilege()` is
  false for `anon` and `PUBLIC`, true for `authenticated`; under an
  impersonated admin claim the list totals equal the stat-card counts for
  `all`, `matched`, `inactive_employee` and `offline`; `p_limit` caps rows
  while `total_count` stays uncapped; an unknown user is refused with `not
  permitted`; an injection-shaped `p_filter` is rejected with `unknown scan
  filter`.
- **Drift found while doing this — live is ahead of the repo.**
  `supabase_migrations.schema_migrations` on the live project lists
  `onsite_roster` and `dashboard_scanner_registry_alerts` (both
  2026-09-28), and `get_all_scan_events_add_date_filter`,
  `export_scan_logs_rpc` / `drop_redundant_export_scan_logs_rpc`
  (2026-09-24); none of them has a file in `Supabase/migrations/`. The live
  project also has RPCs with no caller in the client and no entry in this
  file: `get_dashboard_stats`, `get_onsite_roster`, `get_alerts`,
  `get_unread_alert_count`, `get_scanners` (plus `alerts` and `scanners`
  tables they read). Same "backend shipped, UI never followed" pattern as
  the Audit Log and Scanner Analytics. Not reconciled here — `supabase db
  pull` (or `Supabase:list_tables` + `pg_get_functiondef`) is the way to
  capture them before anyone runs `supabase db reset` from this folder.

**2026-09-28 — `get_attendance_report()` added; docs corrected about unmatched scans**
- New read-only RPC + migration file `20260928000000_attendance_report.sql`
  (applied to the live project via MCP as `attendance_report`; only the
  baseline is otherwise in `Supabase/migrations/`, and only Edge Functions
  auto-deploy, so this file is the version-controlled record). Full
  contract in the RPC section above.
- Verified against live data before wiring a client: the core query on
  real September rows (night shifts crossing UTC midnight land on the
  right Manila date; multiple IN/OUT pairs per day sum correctly), then
  the real function under an impersonated admin claim, then the guard
  paths (no auth context → `not permitted`, range > 31 days, unknown
  time zone). `has_function_privilege()` confirms anon/PUBLIC can't
  execute it. `get_advisors` (security): only the accepted
  self-checking-`SECURITY DEFINER` baseline, now 23 functions instead
  of 22.
- **Doc correction, no behavior change:** this file claimed every scan
  attempt (including `unmatched`) is stored in `scan_events`. The live
  `scan_proximity_code()` never inserts `unmatched` — live data confirms
  it (1,882 rows, all `matched`). Corrected the `scan_events` table row,
  `get_all_scan_events()`, and `get_scanner_performance_stats()` entries.
  The Scanner Analytics page had an "Unmatched" card that could only ever
  read 0 because of this; it now appears only if such rows exist.
- Not changed, deliberately: whether `scan_proximity_code()` *should*
  store unmatched scans. That is a product/security call (useful signal vs.
  unbounded junk inserts from any scanner-scope account) for the owner.

**2026-09-26 — Documented `get_scanner_performance_stats()`; built the Scanner Analytics page it was always meant to back**
- No schema/RPC change — `get_scanner_performance_stats(p_days)` was
  already live, fully secured (`is_admin() or can_view_scanner()`, same
  gate as `get_scan_feed()`), and returning exactly the summary/
  by-scanner/daily shape documented above, from an earlier session's work
  that never made it into this file or got a caller anywhere in the
  client. Same "DB side already live, undocumented" pattern as the audit
  log's 2026-09-21 entry. Added the RPC entry above and the client-side
  `Analytics/AnalyticsPage.js` + `Models/ScannerStatsModel.js` — see root
  `README.md`'s matching entry for the page itself.
- Verified via `pg_get_functiondef()` and a fresh `get_advisors` (security)
  pass before wiring a caller to it — no new findings; this function was
  already part of the accepted `SECURITY DEFINER`-self-checks baseline.
- No new RLS or grant changes: the page's own `canViewScanner()` guard is
  a UI convenience only, the RPC's internal check is what actually
  matters, and that check was already correct.

**2026-09-24 — `get_all_scan_events()` added; `REVOKE ... FROM PUBLIC` doesn't cover `anon` on this project**
- Full writeup in root `README.md`'s matching 2026-09-24 entry. Schema-
  level short version: this project has a default privilege
  (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
  authenticated`) applied automatically at `CREATE FUNCTION` time,
  separate from the `PUBLIC` pseudo-role — so `REVOKE EXECUTE ON FUNCTION
  ... FROM PUBLIC` does NOT remove `anon`'s access on its own; it needs
  its own explicit `REVOKE ... FROM anon`. Caught immediately via
  `has_function_privilege('anon', ..., 'EXECUTE')` while locking down the
  new function below, before it ever shipped un-audited.

**2026-09-21 — Slow query logging fixed to the right roles + `pg_stat_statements` RPCs**
- **Fixed a real bug from an earlier, cut-off session**: it had set
  `log_min_duration_statement = 200` on the `postgres` role — which is
  never the role live app traffic runs as (PostgREST impersonates
  `anon`/`authenticated`/`service_role`, not `postgres` or
  `authenticator` — see the new "Query performance" section above for
  the full explanation). That meant the earlier session's slow-query
  logging was silently capturing nothing for real requests. Corrected by
  also setting it on `anon`, `authenticated`, and `service_role`, then
  `NOTIFY pgrst, 'reload config'` (the earlier session's change hadn't
  needed this, since a `postgres`-role setting takes effect immediately
  on that connection — another sign it was never actually going to touch
  app traffic). Verified via `pg_roles.rolconfig`, not assumed fixed.
- New RPCs `get_slow_query_stats(p_threshold_ms, p_limit)` and
  `reset_slow_query_stats()` — see "Query performance" above for the
  full contract, the `pg_read_all_stats` ownership detail, and the real
  findings (directory listing averaging ~230ms) turned up while
  verifying this against live data.
- Grants verified via `has_function_privilege()`: `anon` blocked,
  `authenticated` allowed, matching every other RPC here.
- Ran `get_advisors` (security) after — no new findings beyond the
  pre-existing, already-accepted baseline (every `SECURITY DEFINER`
  function here self-checks permissions internally, which the advisor
  flags generically regardless of that).

**2026-09-21 — Documented the audit log feature (DB side was already live, undocumented)**
- No schema/RPC change — `audit_log`, `log_audit_event()`, `get_audit_log()`,
  and all three audit triggers were already fully built and correctly
  secured from an earlier session's work this same week; they'd just
  never made it into this file. Added the full "Audit log" section above
  and the `audit_log` table row, including the security fix that session
  made (`log_audit_event()` was briefly `authenticated`-callable directly)
  and the one known gap left open (`admin-users` doesn't log account
  create/reset-password/delete). See root `README.md`'s matching entry
  for the client-side `AuditLogPage.js` that was actually missing and
  got built this session.

**2026-09-21 — `upload-employee-photo`: Google auth failures get a stable code; typecheck fix**
- Reported as "Google Drive token expired". Root cause class: Google's
  `invalid_grant` on the **refresh token** (not the access token, which
  already renews itself silently on every call). Previously surfaced as a
  bare 500 carrying Google's raw wording; now a 503 with
  `code: "google_reauth_required"` (or `google_client_invalid`) and an
  actionable message, and the underlying Google error is written to the
  function log (`Google token refresh failed (HTTP 400): invalid_grant — …`)
  so the cause can be confirmed rather than guessed. No client change was
  needed: `EmployeesModel.js`'s upload/delete/quota paths already display
  `body.error` verbatim.
- `concatBytes()`'s explicit `: Uint8Array` return annotation made
  `deno check` fail on Deno/TypeScript 5.7+ (`Uint8Array<ArrayBufferLike>`
  is no longer a valid `fetch()` body). CI's typecheck job runs
  `deno-version: v2.x` (newest 2.x), so this fails the `typecheck` job and
  the dependent `deploy` job never runs — a plausible reason the repo can sit
  ahead of the live function without any visible error. Return type is now
  inferred; no runtime change.
- **Drift as of this entry:** live `upload-employee-photo` was v36
  (2026-09-19 02:37 UTC) and still had the original server-side `sz=w96`
  thumbnail fetch, with no handling of the client-supplied
  `thumb_base64` — i.e. the client sends a ~480px thumbnail that the live
  function ignores. This repo's `index.ts` has the newer behavior. Run
  `Supabase:list_edge_functions` / `get_edge_function` before assuming either
  side is current.
- `README.md` for the function rewritten: request/response contract now
  includes `quota`, the thumbnail fields, the `thumbnail?id=…` URL format
  (it still documented the retired `uc?export=view` URL), and the error-code
  table.

**2026-09-19 — Dropped a redundant, unused RPC (self-correction)**
- `clear_employee_scan_log(p_employee_id)` — a whole-log-nuke function
  added earlier this same session as a first attempt at "let an admin
  delete scan log entries," before discovering the properly-scoped,
  already-deployed `delete_employee_scan_log(p_employee_id, p_scan_id)`
  (per-row delete — see its own entry below) was already live from a
  different session. Nothing in the deployed frontend ever called the
  whole-log version, so it was `DROP FUNCTION`-ed rather than left as
  unused, confusing surface area. See root `README.md`'s matching
  change log entry.
- `get_scanner_offline_cache()`/`classify()` gap (no RPC change): the RPC
  has returned `remarks_log` on every row all along — the client-side
  `classify()` just wasn't passing it through. Pure frontend fix, see
  root `README.md`.

**2026-09-19 — `upload-employee-photo`: prefer a client-supplied `.webp` thumbnail over the server-side Drive fetch**
- No schema change. `upload`'s request body gained optional
  `thumb_base64`/`thumb_mime_type` — see the Edge Function entry above for
  the full contract and root `README.md`'s matching change log entry for
  why (the old `sz=w96` server-side fetch had gone visibly blurry once the
  Scanner started displaying `photo_thumb_b64` at up to
  `min(82dvh, 82dvw)`, and Drive's `/thumbnail` endpoint has no way to
  request `.webp` output specifically, which is why the client generating
  its own thumbnail was the fix rather than just asking Drive for a
  different size).
- The server-side Drive fetch this replaces as the primary path is still
  there as a fallback (now `sz=w480`, not `sz=w96`) for a client that
  didn't supply one.

**2026-09-19 — Split `get_scanner_offline_cache()`'s photo payload into `get_scanner_offline_photos()`**
- New RPC `get_scanner_offline_photos()` — see RPC section above for the
  full contract. `get_scanner_offline_cache()`'s `jsonb_build_object` no
  longer includes `photo_thumb_b64`.
- Backend-only change (this migration, `split_offline_lookup_and_photos`)
  landed same-day as, but separately from, the client-side follow-through
  in root `README.md`'s matching change log entry — flagging that gap
  explicitly here since it's exactly the kind of drift this file warns
  about elsewhere ("the live version can be ahead of this repo"). Always
  `Supabase:list_migrations` before trusting either README's account of
  what's actually deployed.
- Grants double-checked via `has_function_privilege()` rather than
  assumed correct by analogy to the sibling RPCs: `anon` cannot execute,
  `authenticated` can — same as `get_scanner_offline_cache()` and
  `get_scan_feed()`.

**2026-09-19 — `upload-employee-photo`'s thumbnail fetch bounded to a timeout (v33)**
- The only Postgres/Edge Function-side piece of a 3-bug regression report
  after 2026-09-18's `photo_thumb_b64` change — the other two
  (sync-queue slow, Alt-Tab "Loading…") were pure client-side bugs, fully
  detailed in root `README.md`'s matching entry, which also documents a
  deliberately-deferred scaling concern with this RPC's payload shape
  (photos riding along in a frequently-refreshed roster-wide cache) worth
  reading if you're about to touch this area again.
- No schema change. `upload-employee-photo`'s server-side thumbnail fetch
  (see its Edge Function entry above) now carries a 2.5s
  `AbortSignal.timeout()` — it previously had none at all, so a
  freshly-uploaded file's thumbnail not being instantly ready on Drive's
  side (a real, fairly common few-second lag) sat directly in the
  upload's own response time, reported directly as "upload speed slow."

**2026-09-18 — `employees.photo_thumb_b64`: replaced Drive-prefetch with a stored server-side thumbnail**
- New column `employees.photo_thumb_b64` (text) — a small base64 JPEG,
  written by `upload-employee-photo`'s `upload` action right after every
  successful upload (see its Edge Function entry above).
- `get_scanner_offline_cache()` and `get_scan_feed()` (`CREATE OR REPLACE`,
  same signatures as before — no overload risk this time, unlike the
  2026-09-16 `scan_proximity_code()` mistake) both now return it.
- **Why:** the previous approach — a roster-wide client-side prefetch of
  every employee's Drive thumbnail into a Service Worker cache — fetched
  each one with `{mode:'no-cors'}` (required, since Drive's `/thumbnail`
  endpoint sends no CORS headers for a page-script `fetch()`). A `no-cors`
  response is always "opaque" (`status: 0`, `ok: false`) **whether or not
  the request actually succeeded** — there is no way to tell a real
  failure apart from success. Across 700+ concurrent-ish requests, that
  meant some fraction silently "succeeded" as empty/failed cache entries
  on every single prefetch pass, with no error, no pattern, and no way to
  detect it client-side. Fetching the same thumbnail **server-side**
  instead (a normal fetch from Deno to Google, no CORS involved at all)
  makes `res.ok` a real, trustworthy signal — a failure there is a real,
  loggable failure, not indistinguishable from success.
- `get_advisors` (security) re-run after both `CREATE OR REPLACE`s —
  clean, same 3 pre-existing `anon`-executable findings as before
  (`can_manage_scan_sounds`, `can_view_settings`, `rls_auto_enable` — none
  from this work), confirmed via `has_function_privilege()` that neither
  changed function is `anon`-executable.
- Full client-side detail (deleted `prefetchPhotos()`, `sw.js`'s
  `PHOTO_CACHE`, the live-retry-fetch; new `offlineAvatarHTML()`) in root
  `README.md`'s matching change log entry.

**2026-09-17 — Fixed a real concurrency bug in `trg_append_scan_log()`, plus one more offline-photo gap**
- **Root cause of the IN/OUT/OUT/IN corruption seen in Employee Manager's
  scan log** (reported with screenshots — two employees' logs showing
  broken alternation): `trg_append_scan_log()` used to `SELECT
  jsonb_array_length(scan_logs)`, compute `direction`, THEN run a separate
  `UPDATE` — two statements with no row lock between them. Two
  `scan_events` inserts for the same employee landing close together (a
  live kiosk scan racing an offline-queue replay, in particular, though
  any two near-simultaneous scans could trigger it) could both `SELECT`
  the same stale count and both compute the same direction before either
  `UPDATE` committed. Fixed by moving `jsonb_array_length(scan_logs)`
  *inside* the `UPDATE`'s `SET` clause — Postgres locks the target row for
  the duration of an `UPDATE`, so a second concurrent `UPDATE` for the
  same employee now blocks until the first commits, then evaluates
  `scan_logs` fresh against the just-updated row. Single atomic statement,
  same guarantee `add_employee_remark()` already relies on.
- `scan_proximity_code()` no longer computes its own `direction` via a
  second, independent `SELECT` before the insert (which could itself
  still drift from the trigger's answer under concurrency, even after the
  fix above) — it now reads the trigger's own just-written value back
  (`scan_logs -> -1 ->> 'direction'`) after the insert, since
  `trg_scan_events_append_log` fires synchronously (`AFTER INSERT`, same
  transaction) before the function continues. Single source of truth, no
  duplicate logic, provably matches what's actually stored.
- Each `scan_logs` entry now also carries `'offline'` (from
  `scan_events.raw_payload->>'captured_offline'`) — lets
  `JS/Components/ScanLogModal.js` show *why* a backdated entry might sit
  at a position that looks out of chronological order (see its own entry
  in root `README.md`'s change log: insertion order and `scanned_at` order
  can legitimately differ once offline-synced scans exist, and the modal
  now displays true insertion order rather than re-sorting by time, which
  would visually "un-alternate" an otherwise-correct sequence).
- **One-time data repair**, disclosed here rather than done silently:
  ran a migration recomputing `direction` for all 14 employees who had
  any `scan_logs` history, purely from array position parity (1st scan
  ever = in, 2nd = out, ... — fully deterministic, so this is a lossless
  correction of bad values the bug above had written, not a reinterpretation
  of history). No other field touched.
- Also closed one more offline-photo gap on the client side: `classify()`
  is purely local and never itself attempts a network request, so a photo
  the background prefetch (see 2026-09-17 entries above) hadn't reached
  yet for a given employee fell straight to the default avatar — even in
  the common case where "offline" actually means Supabase specifically
  failed while the general connection (and Drive) is still fine. See
  root `README.md`'s change log for the client-side fix
  (`Utils/format.js`, `Scanner/StandaloneScanner.js`).

**2026-09-17 — Offline scanner client-side bug fixes (no schema/RPC change)**
- No Postgres changes — `get_scanner_offline_cache()` already returned
  `photo_url`/`updated_at`; `JS/Models/OfflineScanModel.js#classify()` just
  wasn't passing them through to the rendered result, which is why offline
  scans showed initials instead of the employee photo. See root
  `README.md`'s change log for the full list of client-side fixes
  (resync-on-reconnect, Recent Activity not updating post-sync, and
  scan-sound loading never retrying after a failed first attempt).

**2026-09-16 — Offline scanning: `get_scanner_offline_cache()` + backdated `scan_proximity_code()`**
- `scan_proximity_code()` gained two optional, backward-compatible params:
  `p_scanned_at` (default `now()`) so a scan replayed from the offline
  queue keeps its true original time, and `p_offline` (default `false`)
  to tag the row's `raw_payload` for audit visibility. See "Offline
  scanning" above for the full picture, including the client side.
- New `get_scanner_offline_cache()` RPC — trimmed card/employee projection
  for the client's local IndexedDB cache.
- **Self-caught bug, worth recording so it's recognizable if it recurs:**
  the first attempt at the `scan_proximity_code()` change used
  `CREATE OR REPLACE FUNCTION` with new parameters added — Postgres
  matches `CREATE OR REPLACE` by argument *types*, so a changed signature
  creates a **new, separate overload** rather than replacing the old one.
  This left the original 2-arg function orphaned alongside the new 4-arg
  one, and — because this project grants `EXECUTE` to `PUBLIC` by default
  on newly `CREATE`d functions, unlike the explicit per-function grants
  everything else here relies on — the new overload was briefly callable
  by `anon` (unauthenticated) via PostgREST. Caught via `get_advisors`
  (security) before this was ever exposed to real traffic; fixed by
  `DROP FUNCTION`-ing the orphaned 2-arg overload and explicitly
  `REVOKE`-ing `public`/`anon` + `GRANT`-ing `authenticated` on both new
  functions, then confirmed clean via `has_function_privilege()`.

**2026-09-16 — Settings permission scoping (`can_view_settings()` / `can_manage_scan_sounds()`) + `upload-employee-photo` `quota` action**
- Settings now opens for any account whose `access_scope` covers a
  Settings-relevant module, not just admins — reusing the existing
  `role`/`access_scope` pair (see Permission model above) instead of a
  new column. `employee_manager` scope shows only the Employee photos
  panel, `scanner` scope shows only Scan sounds, `all` shows both.
- Added `can_manage_scan_sounds()` and `can_view_settings()` SQL
  functions; replaced the `scan-sounds` bucket's 3 admin-only write RLS
  policies (`scan_sounds_admin_write/update/delete`) with
  `scan_sounds_manage_insert/update/delete`, now checking
  `can_manage_scan_sounds()` so managers with covering scope can
  upload/replace/remove sounds too, not just admins. The read policy was
  already open to any authenticated caller and didn't need to change.
- `upload-employee-photo` gained a `quota` action (Drive `about.get` ->
  `storageQuota`) and switched from one blanket auth check to a
  per-action one — `quota` needs only `can_view_settings()`, `upload`/
  `delete` keep the original `is_admin_or_manager()` — so Settings'
  Employee photos capacity panel works for Viewers with Settings access,
  without loosening who can actually write photos.
- Added `MAX_FILE_SIZE_BYTES` export to `ScanSoundsModel.js` and a
  `fmtBytes()` helper to `Utils/format.js` for both panels' capacity math.

**2026-09-15 — `scan-sounds` Storage bucket + `test_scan_proximity_code()` direction fix**
- Added the `scan-sounds` public bucket and its 3 admin-only write RLS
  policies + 1 authenticated-read policy (see Storage section above).
- `CREATE OR REPLACE FUNCTION public.test_scan_proximity_code` — added the
  same `v_prior_count`/`v_direction` parity computation
  `scan_proximity_code()` already had, purely as a read-only preview
  (nothing written). Before this it always omitted `direction`, so a
  matched test scan could never show the IN/OUT badge in `ScanResultCard.js`
  or (once sounds shipped) play the IN vs. OUT sound — only a real scan
  through the logging scanner could. Ran `get_advisors` (security +
  performance) after both changes — nothing new flagged.
