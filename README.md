# Proximity — ID & Access System

A permission-based employee ID / proximity access system, built on Supabase
(Postgres + Auth + Edge Functions).

Live Supabase project: **`proximity`** (`kjwttqmbcjvkivgmwuev`)
Project URL: `https://kjwttqmbcjvkivgmwuev.supabase.co`

## 1. Project structure

```
index.html                 Redirect-only stub at the repo root, to
                             Public/index.html — the real app lives there
                             (see that entry below), never here. Exists so
                             hitting the bare site root (GitHub Pages, a
                             plain `npx serve .` with no path typed in,
                             any static host pointed at the repo root)
                             lands somewhere instead of a 404 or a raw
                             directory listing. Relative redirect path
                             (`Public/index.html`, not `/Public/index.html`)
                             deliberately — this file can end up served
                             from a domain root OR a subpath (a GitHub
                             Pages *project* site is served under
                             /<repo-name>/, not the domain root), and only
                             the relative form resolves correctly either
                             way. JS `location.replace()` first (instant,
                             no back-button entry of its own), a
                             `<meta http-equiv="refresh">` as the no-JS
                             fallback, and a visible link as the last
                             resort. Not part of the app itself — never
                             add real markup, styles, or logic here.

sw.js                      Service Worker — offline app-shell caching. Lives at
                             the repo root (NOT inside Public/) deliberately: its
                             scope is its own directory + below, and index.html
                             (in Public/) references ../CSS and ../JS as
                             *siblings*, not children — a worker registered from
                             inside Public/ could never see those fetches at all.
                             Registered from JS/main.js via an absolute
                             `/sw.js` path. See Supabase/README.md's "Offline
                             scanning" section for the full offline architecture.

CSS/                       Stylesheets, split by concern, composed by main.css
  variables.css               design tokens (colors, spacing, fonts)
  base.css                    resets + form controls
  layout.css                  app shell (sidebar/topbar/content)
  components.css              shared components: table, badge, modal, toast, panel…
  auth.css                    sign-in screen (no self-service account creation)
  scanner.css                 in-shell scanner + standalone scanner tab;
                               hero ring/icon are sized with clamp(px, dvh, px)
                               rather than fixed px, so the kiosk hero scales
                               with viewport height (dvh, not vh, for correct
                               behavior on mobile browsers that resize the
                               viewport when browser chrome shows/hides)
  main.css                    entry point — @imports the above in order

JS/
  main.js                     bootstrap: single boot() — wires auth-state changes,
                               resolves the session/profile, guards against the
                               scanner-only-account-lands-in-admin-shell race,
                               and restores route from the URL hash on reload;
                               also registers /sw.js (see root entry above)
  Core/                       app-wide plumbing, not tied to any one feature
    supabaseClient.js            the one Supabase client instance
    state.js                     session/profile/route state + permission checks
                                  (role: admin/manager/viewer, access_scope:
                                  all/employee_manager/scanner)
    router.js                    route table, render dispatch, nav wiring,
                                  hash-based route persistence
    screens.js                   top-level screen switch (auth / shell / standalone scanner)
  Models/                     one file per Supabase table/view, all built on BaseModel
    BaseModel.js                 reusable list/get/create/update/remove factory
    EmployeesModel.js             listDirectory() reads employee_directory view
    ProximityCardsModel.js
    ProfilesModel.js              callAdminUsers() invokes the admin-users Edge
                                   Function for admin-only account actions
                                   (create/reset-someone-else's-password/delete);
                                   changePassword() (added 2026-09-28) is the
                                   separate self-service path — plain
                                   supabase.auth.updateUser(), no Edge Function
                                   involved — see Settings/SettingsPage.js
    ScanEventsModel.js            scan() and testScan() call compact wrappers
                                   around the live scan RPCs;
                                   recentFeed() reads get_scan_feed();
                                   listAll() reads get_all_scan_events()
                                   (added 2026-09-24, admin/manager-only,
                                   the FULL scan_events history — backs
                                   Directory/DirectoryPage.js's "Export
                                   all scan logs" button, distinct from
                                   recentFeed()'s "recent" scope)
                                   (EmployeesModel.uploadPhoto() below uses raw XHR, not
                                   supabase.functions.invoke(), specifically for upload progress)
    ScanSoundsModel.js             wraps the public `scan-sounds` Storage bucket
                                   (list/upload/remove) behind 5 fixed, extension-
                                   less object keys — see Settings/SettingsPage.js
    OfflineScanModel.js             IndexedDB-backed lookup cache + offline scan
                                   queue for the standalone Scanner — see
                                   Scanner/StandaloneScanner.js and
                                   Supabase/README.md's "Offline scanning" section
    AuditLogModel.js                thin wrapper over get_audit_log() — the RPC
                                   itself is the real gate, this just calls it
    QueryStatsModel.js              added 2026-09-21; thin wrapper over
                                   get_slow_query_stats()/reset_slow_query_stats()
                                   — same "the RPC is the real gate" pattern as
                                   AuditLogModel.js, see Settings/SettingsPage.js's
                                   "Query performance" panel and
                                   Supabase/README.md's change log
    ScannerStatsModel.js             added 2026-09-26; thin wrapper over
                                   get_scanner_performance_stats() — an RPC
                                   that was already live on the database with
                                   no caller anywhere in the client until this
                                   session; see Features/Analytics/AnalyticsPage.js
                                   below and Supabase/README.md's change log
    AttendanceModel.js              added 2026-09-28; thin wrapper over
                                   get_attendance_report(); passes the
                                   browser's time zone so "which day" matches
                                   the reader's calendar
    DashboardModel.js               added 2026-09-28; wrappers over
                                   get_dashboard_stats() / get_onsite_roster()
    AlertsModel.js                  added 2026-09-28; get_alerts(),
                                   get_unread_alert_count(),
                                   acknowledge_alert(), acknowledge_all_alerts()
    ScannersModel.js                added 2026-09-28; get_scanners() /
                                   update_scanner()
    ScanLogsTrimModel.js            added 2026-10-01; wrappers over
                                     get_scan_logs_trim_status()/
                                     trim_employee_scan_logs() — backs
                                     Settings' "Scan log trimming" panel,
                                     same pattern as ScanArchiveModel.js
    ScannerSilenceModel.js          added 2026-10-02; wrappers over
                                     get_scanner_silence_status()/
                                     check_scanner_silence() — backs
                                     Settings' "Scanner silence alerts"
                                     panel, same pattern as the two above
    ScanArchiveModel.js             added 2026-09-30; wrappers over
                                   get_scan_archive_status() /
                                   archive_old_scan_events() — backs
                                   Settings' "Scan data archival" panel
  Components/                 reusable UI pieces used by more than one feature
    Modal.js                     shared openModal/closeModal scaffold — every
                                  dialog below is built on this
    EmployeeModal.js
    ProximityCardModal.js
    UserModal.js
    ResetPasswordModal.js
    ScanDetailsModal.js           the scans behind an Analytics stat card or
                                  scanner row (added 2026-09-28) — read-only
                                  list + Export .xlsx, over
                                  get_scanner_scan_details()
    ScanLogModal.js               per-employee scan log, date/scanner filters;
                                  Export .xlsx button next to the title (added
                                  2026-09-19, exports the full filtered set,
                                  not just the RENDER_CAP-limited painted
                                  rows), and an admin-only per-row delete (×)
                                  that removes both the scan_events row and
                                  the cached scan_logs entry via the
                                  delete_employee_scan_log() RPC — see
                                  Supabase/README.md
    ScanResultCard.js
    ScanFeed.js                  Recent Activity list (last 10 scans)
    ProximityLogo.js             exports PROXIMITY_LOGO_SVG — the brand
                                  mark, inlined (not <img src>) so its
                                  fill="currentColor" paths pick up theme
                                  color from the page; used by the
                                  Scanner/Test Scan "Tap your card" hero
    ImportModal.js                CSV bulk-import dialog, shared by Employee
                                  Manager and Proximity Cards; both show
                                  upload progress
  Features/                   one folder per screen/area of the app
    Auth/AuthScreen.js               (sign-in only — no self-service account
                                       creation, removed 2026-09-19; Enter in
                                       either field submits, same as clicking
                                       Sign in)
    Directory/DirectoryPage.js       (Employee Manager — avatarHTML() helper,
                                       cache-busted via updated_at; the Edit/Add
                                       modal's photo picker shows a real upload
                                       progress bar, incl. an indeterminate
                                       shimmer while the function talks to Drive;
                                       toolbar Export .xlsx button, added
                                       2026-09-19, exports the current
                                       search/filter view via Utils/xlsxExport.js;
                                       toolbar "Export all scan logs" button,
                                       added 2026-09-24, admin/manager-only —
                                       the full org-wide scan_events history
                                       via ScanEventsModel.listAll(), not any
                                       one employee's scan_logs)
    Proximity/ProximityPage.js       (Proximity Cards; toolbar Export .xlsx
                                       button, added 2026-09-19, same pattern
                                       as Employee Manager's)
    Scanner/TestScanPage.js          (in-shell "Test Scan" — calls the
                                       non-logging compact test-scan RPC,
                                       which now also returns a read-only `direction`
                                       preview (see Supabase/README.md) so IN/OUT
                                       badges and sounds show up here too, not just
                                       on the real scanner; hero icon is the inlined
                                       Proximity logo mark, label reads "Tap your card";
                                       loads scan sounds once per page visit)
    Scanner/StandaloneScanner.js     (the real, logging ?scanner=1 tab;
                                       same hero mark/label, direction badge, and
                                       scan-sound playback as Test Scan; also the
                                       only screen with offline support — header
                                       status pill shows online/offline, pending
                                       queued-scan count, and lookup-cache staleness;
                                       see Supabase/README.md's "Offline scanning")
    Analytics/AnalyticsPage.js       (Scanner Analytics, added 2026-09-26 — same
                                       gate as Test Scan/Scanner, canViewScanner();
                                       summary stat cards, a dependency-free daily
                                       trend chart, and a per-scanner match-rate
                                       table, all over get_scanner_performance_stats()
                                       — an RPC that was already live and secured
                                       on the database with no caller until this
                                       page; date-range picker, 7/14/30/90 days,
                                       matching the RPC's own p_days clamp; see
                                       Supabase/README.md's change log)
    Dashboard/DashboardPage.js       (Dashboard, added 2026-09-28 — admin/manager
                                       only; headline stat cards from
                                       get_dashboard_stats() plus the live "On
                                       site now" roster from get_onsite_roster()
                                       with search/department/view filters,
                                       pagination, .xlsx export, 30s auto-refresh
                                       while open; cards click through to the
                                       page behind them)
    Alerts/AlertsPage.js             (Alerts inbox, added 2026-09-28 — admin/manager
                                       only; acknowledge one or all, "show
                                       acknowledged" toggle; the unread count is
                                       the badge on the sidebar button, kept
                                       fresh by Core/alertsBadge.js)
    Attendance/AttendancePage.js     (Attendance, added 2026-09-28 — admin/manager
                                       only, mirrors get_attendance_report()'s
                                       is_admin_or_manager() gate; date-range
                                       report of first IN / last OUT / time on
                                       site per employee per day, name/department/
                                       status filters, pagination, .xlsx export of
                                       everything matching the filters; see
                                       Supabase/README.md for how rows are derived)
    Users/UsersPage.js               (Users & Roles, admin-only; delete wired
                                       through admin-users v3+ w/ self-delete guard)
    Users/userOptions.js             (shared role/access-scope option lists)
    Settings/SettingsPage.js         (Settings — "Change password" panel (added
                                       2026-09-28), visible to every signed-in
                                       account regardless of role/scope since
                                       it's account-level, not module-level —
                                       re-authenticates with the current
                                       password via a second signInWithPassword
                                       before calling auth.updateUser(), so an
                                       unattended already-logged-in kiosk
                                       session can't be used to lock the real
                                       owner out; upload/replace/remove/
                                       preview the 5 scan sounds, plus a read-only
                                       Google Drive storage-capacity panel for
                                       employee photos (whole-account quota, not
                                       folder-scoped — see change log); own
                                       top-level route so future non-user settings
                                       have a home; "Query performance" panel
                                       (added 2026-09-21, unconditionally
                                       admin-only unlike the two panels above) —
                                       pg_stat_statements via get_slow_query_stats(),
                                       adjustable threshold, Reset stats button;
                                       "Scan data archival", "Scan log trimming",
                                       and "Scanner silence alerts" panels
                                       (admin-only, same status+"run/check now"
                                       pattern across all three); see
                                       Supabase/README.md's change log)
    Audit/AuditLogPage.js            (Audit Log, admin-only — read-only table over
                                       get_audit_log(); describeEvent() translates
                                       each row's raw {action, entity_type, detail}
                                       into a sentence, with a generic fallback for
                                       any action added to the schema without a
                                       matching update here — see Supabase/README.md's
                                       "Audit log" section for the full list)
  Utils/                      pure helpers, no state, no DOM assumptions
    dom.js                       $ / $$
    format.js                    esc / initials / fmtTime
    toast.js                     toast notifications
    dateRange.js                  shared from/to date-input behaviour: an
                                   inverted range is swapped into order
                                   (orderDateRange, wireDateRangeOrdering);
                                   used by Attendance, Export scan logs and
                                   the per-employee Scan log
    scanDetails.js                pure helpers for the Analytics drill-down:
                                   the filter list (mirrors the RPC's closed
                                   p_filter list), result labels, titles, cap
                                   notice, and canDrillDown() — zero-count
                                   cards aren't clickable
    clipboard.js                  wireCopyableCodes(wrap, label) — click-to-copy
                                   for [data-copy-code] elements (.copyable-code
                                   in CSS/base.css); shared by Employee Manager's
                                   Proximity ID column and Proximity Cards'
                                   Proximity code column
    csv.js                       parseCSV / toCSV, used by ImportModal.js
    dashboard.js                  pure rules for Dashboard / Alerts / Scanners:
                                   who counts as on site (active employees only,
                                   stale = old IN), roster filtering, alert
                                   severity colours, sidebar badge text, scanner
                                   online/offline/disabled state — unit-tested
                                   in test/dashboard.test.mjs
    attendance.js                 pure rules for the Attendance page: row
                                   status (complete / no OUT yet / check
                                   times), duration formatting, 31-day range
                                   validation, filtering, summary — unit-tested
                                   in test/attendance.test.mjs
    avatarPreview.js              added 2026-09-29; Employee Manager's
                                   hover-to-100px-preview for row photos —
                                   DOM/layout only, no pure logic to unit-test
                                   (see Components/ for why this isn't there:
                                   it's small and single-purpose, but every
                                   other file that opens a floating UI element
                                   lives in Utils/ or Components/ by what it
                                   touches, not by size; this one is DOM
                                   positioning, not a dialog, so Utils/ fit
                                   better than adding a Components/ entry for
                                   something with no form/actions)
    scanSounds.js                 loadScanSounds() / playScanSound() — shared by
                                   StandaloneScanner.js and TestScanPage.js
    idb.js                         hand-rolled minimal Promise wrapper around
                                   IndexedDB (3 object stores: offline lookup
                                   cache, offline scan queue, offline photo
                                   cache — added 2026-09-19, see change log) —
                                   the only thing backing OfflineScanModel.js;
                                   no external idb library, to keep this repo
                                   dependency-free
    xlsxExport.js                  exportXlsx({filename, sheetName, columns,
                                   rows}) — added 2026-09-19, built on the
                                   vendored SheetJS mini build (window.XLSX,
                                   see Public/Vendor/README.md). Every
                                   "Export .xlsx" button (Employee Manager,
                                   Proximity Cards, Scan Log) goes through
                                   this one function so the columns:[{key,
                                   label, text:true}] convention — forcing
                                   a code-like column to real text so Excel
                                   can't silently reinterpret it as a number
                                   — lives in exactly one place

Public/
  index.html                  the app shell (static markup only — all
                               behavior lives in JS/*). References ../CSS
                               and ../JS.
  Assets/
    Favicon/favicon.svg
    Icon/icon.svg
    Logo/proximity-logo.svg      brand mark (fill="currentColor"). Not
                                  referenced via <img src> anywhere — see
                                  JS/Components/ProximityLogo.js, which
                                  inlines this same artwork as a template
                                  string so currentColor actually themes
                                  it. Keep both in sync if the mark changes.
    Sounds/                      5 bundled default scan-outcome tones
                                  (matched-in / matched-out / card-revoked /
                                  unmatched / unassigned-card, all .wav),
                                  precached by sw.js at install time — see
                                  "Offline-first design" below. Generated by
                                  the repo-root gen_sounds.py (stdlib only,
                                  no deps); re-run it if these ever need to
                                  change instead of hand-editing audio files.
    EmployeePhoto/
      default-avatar.svg           bundled generic silhouette, precached by
                                    sw.js at install time; Utils/format.js's
                                    avatarHTML() falls back to it when there
                                    IS a photo_url but the real Drive photo
                                    can't load (Employee Manager/Directory
                                    only — a transient error, not an offline
                                    scenario; the Scanner uses
                                    offlineAvatarHTML()'s stored base64
                                    thumbnail instead, see "Offline-first
                                    design" below), before finally falling
                                    back to initials. No photo_url at all
                                    skips straight to initials.
  Vendor/
    supabase-js.umd.js           vendored @supabase/supabase-js (see Vendor/README.md)
    xlsx.mini.min.js              vendored SheetJS xlsx@0.18.5 mini build,
                                   added 2026-09-19 — Apache-2.0, see
                                   Vendor/README.md and xlsx.LICENSE.txt

Supabase/
  README.md                   schema, RPC, and permission-model reference
  functions/
    proximity-scan/README.md         request/response contract
    admin-users/README.md            request/response contract
    upload-employee-photo/README.md  request/response contract
```

No build step: everything is native ES modules and a couple of plain
`<script>` tags. `JS/main.js` is loaded as `type="module"`, which browsers
refuse to run from a `file://` URL — so serve the `Public/` folder over
HTTP (see below) rather than double-clicking `index.html`. Service Workers
have the same restriction plus one more: they also require HTTPS in
production (`localhost`/`127.0.0.1` is exempt, which is why offline mode
works fine under Five Server in dev without any extra setup).

## 2. Architecture

```
┌───────────────────────┐        ┌──────────────────────────────────────────┐
│  Public/index.html     │  REST  │  Supabase Postgres                       │
│  + JS/* modules         │◄──────►│  - profiles           (login + role)     │
│  - Auth (login/sign)    │  RLS   │  - employees          (Employee Manager) │
│  - Employee Manager     │        │  - proximity_cards    (Proximity table)  │
│  - Proximity Cards      │        │  - scan_events        (Scanner log)      │
│  - Test Scan / Scanner  │        │  - employee_directory (read view, SD)    │
│  - Scanner Analytics    │        │                                          │
│  - Users & Roles        │        │  - scan_feed          (read view, SD)    │
│  - Settings             │        └──────────────────────────────────────────┘
└──────────┬─────────────┘
           │
           ├── RPC / Edge Functions ──────────────────────────────────────┐
           │                                                              ▼
           │                                              ┌────────────────────────────┐
           │                                              │ proximity-scan               │
           │                                              │ admin-users                   │
           │                                              │ upload-employee-photo         │
           │                                              │ (see table below)             │
           │                                              └────────────────────────────┘
           │
           └── Storage (scan-sounds bucket) ── 5 fixed keys, public read,
                                                admin-only write via RLS
```

| Edge Function | Purpose |
| --- | --- |
| `proximity-scan` | Hardware/kiosk scanners that can't run the JS SDK: `POST { proximity_code, scanner_id }` + Bearer JWT → `scan_proximity_code()` RPC |
| `admin-users` | Admin-only create/update/reset_password/delete on login accounts (needs the service-role key, never exposed to the browser) |
| `upload-employee-photo` | Employee photo upload; always writes a new UUID-named Drive file (never overwrites in place) so the CDN never serves a stale thumbnail |

("SD" = `SECURITY DEFINER` — both read views run as definer so scanner-only
and manager accounts still see joined rows under RLS; see
[`Supabase/README.md`](./Supabase/README.md) for why.)

Full schema, RPC, and permission-model details: [`Supabase/README.md`](./Supabase/README.md).

## 3. Running it

`Public/index.html` (the real app) references `../CSS` and `../JS` — it
expects to be served from *inside* the repo root, not as the root itself.
`npx serve Public` alone won't resolve those (or `/sw.js`). Serve the repo
root instead:

```
npx serve .
```

Then just open the printed URL's bare root (e.g. `http://localhost:3000/`)
— the root `index.html` redirect stub takes you straight to
`Public/index.html`, so there's no nested path to remember or type. Same
if you're using Five Server in VS Code: right-click `Public/index.html`
and "Open with Five Server" still works exactly as before (e.g.
`http://127.0.0.1:5500/Public/index.html`), or just browse to the bare
`http://127.0.0.1:5500/` root instead now that it redirects.

Sign in with credentials for an existing account. **Brand-new deployment,
no accounts yet?** There's no self-service sign-up UI (removed
2026-09-19 — see change log) — create the first user directly in the
Supabase Dashboard: **Authentication → Users → Add user**, set an email +
password there. `handle_new_auth_user()` (the same trigger that always
handled this) fires on that insert exactly like it did for the old
sign-up form and auto-promotes it to admin, since it checks "does
`profiles` have anyone yet at all," not which UI created the row. Sign in
with those credentials here, then create everyone else's accounts under
**Users & Roles** instead of the Dashboard — that's the one-time
exception, not the new normal path.

Once signed in as admin, add
employees in **Employee Manager**, issue them a code in **Proximity
Cards**, then scan that code in **Test Scan** (in-app) or the standalone
**Scanner** tab (`?scanner=1`, logs to `scan_events`).

As an admin, visit **Settings** to upload a short audio clip for each of
the 5 scan outcomes (Matched/Success IN, Matched/Success OUT, Card
revoked, Unknown proximity ID, Unassigned card) — Test Scan and the live
Scanner both play them automatically as soon as a result comes back. An
outcome with nothing uploaded falls back to a bundled default tone (see
"Offline-first design" below) rather than staying silent — the one
exception is `inactive_employee`, which has no dedicated sound at all
(deliberately: guessing with an unrelated clip would misrepresent the
result) and stays silent either way.

**Offline-first design:** the standalone Scanner (`?scanner=1`) is built
to keep working through a real network outage, not just tolerate a brief
blip — three independent pieces make that true:

- **App shell** (`sw.js`, `APP_CACHE`): network-first with a cache
  fallback, so a normal online load always gets what's actually live, and
  only falls back to the last successfully-cached copy once the network
  request itself fails.
- **Scan sounds** (`SOUND_CACHE` + bundled fallback tones): the 5
  admin-uploaded clips are cache-first-with-refresh, same reasoning as the
  photos below. On top of that, `Public/Assets/Sounds/` ships 5 small
  default tones as static assets, **precached at Service Worker install
  time** (not lazily on first fetch, unlike everything else this file
  caches) — so even a device that has never once been online with this
  app still gets a distinct sound per outcome from its very first scan.
  `JS/Utils/scanSounds.js`'s `playScanSound()` uses the admin's custom
  clip when it's available, falls back to the bundled tone when it isn't
  (no custom sound uploaded, or the custom one fails to load), and keeps
  those three places — `sw.js`'s precache list, `scanSounds.js`'s
  `FALLBACK_SOUND_PATHS`, and the actual files — in sync by filename.
- **Employee photos** (`employees.photo_thumb_b64`): not a Service Worker
  cache at all, unlike sounds above — a small (~480px, `.webp`) thumbnail,
  generated **client-side** by `Utils/image.js`'s `fileToOfflineThumbWebp()`
  at upload time and sent to `upload-employee-photo` alongside the main
  photo, which stores it as-is (falling back to its own lower-res,
  format-unpredictable server-side Drive fetch only if the client didn't
  supply one — see that function's `index.ts` and the 2026-09-19 change
  log entries below). Two different paths carry it from there, split by
  how often each consumer actually needs a refresh: `get_scan_feed()`
  returns `photo_thumb_b64` for initial feed loads, while the standalone
  scanner prepends a matched scan's RPC result rather than re-fetching the
  same recent rows after every scan. The offline scanner's
  `get_scanner_offline_photo_updates()` RPC returns only thumbnails whose
  `photo_file_id` changed (or IDs whose photo was removed), not the full
  roster on every 30-minute refresh. The Scanner's result card and Recent
  Activity render it via `Utils/format.js`'s `offlineAvatarHTML()` — a
  Activity render it via `Utils/format.js`'s `offlineAvatarHTML()` — a
  `data:` URI labeled with the byte-sniffed real mime type (never assumed
  — some earlier rows are PNG or JPEG from before this function existed),
  identical online or offline, nothing to prefetch, cache, or race against
  a network outage. This replaced an entire earlier generation of
  Drive-prefetch machinery (a `PHOTO_CACHE` Service Worker cache, a
  roster-wide background fetcher, cross-origin opaque-response handling)
  that turned out to be fundamentally unreliable at scale — see the
  2026-09-18 change log entry for the full root-cause story. Employee
  Manager and Directory are unaffected: they still use the original
  `avatarHTML()` and the full-resolution Drive `photo_url`, since they're
  always used online and a small thumbnail would be a downgrade there.
- **Queued scans** (`OfflineScanModel.js` + IndexedDB): covered separately
  below.

**Testing offline mode:** open the Scanner tab (`?scanner=1`) at least
once online first — it needs one successful load to cache the app shell
(via `/sw.js`) and the card/employee lookup (via
`get_scanner_offline_cache()`) before there's anything to fall back to
for the *lookup* itself. Scan sounds work from the very first load
regardless (bundled + precached, see above); photos work identically from
the very first offline scan too, since `photo_thumb_b64` rides along in
the same lookup row rather than needing its own separate warm-up. Then in
Chrome DevTools → Network → Throttling → **Offline** (killing the
Wi-Fi/network adapter itself also works, but doesn't let you flip back
online from the same panel to watch the queue sync). Scan a known code —
the header pill
should switch to "◌ Offline" and the result should show "⚠ Offline —
recorded locally, will sync automatically." Switch back to Online and the
queued scan(s) should sync within a few seconds, updating Recent
Activity.

## 4. Suggested next steps

### Automated tests

Run the fast unit suite with `npm test`. It has no package dependencies and
covers the client-side permission matrix, offline scan classification,
direction alternation, and replay ordering/failure handling. GitHub Actions
runs the same suite for every pull request and merge to `main`.

These tests do not replace database integration tests: RLS policies, SQL
RPCs, triggers, and audit writes must be verified against a clean local
Supabase database after the migration baseline and its history are
reconciled. Require both **Unit tests** and **AI Code Review** in GitHub
branch protection before relying on them as merge gates.

- Wire real hardware (RFID/NFC/QR readers) to call the `proximity-scan` Edge
  Function on each read.
- Pull the live schema and Edge Function source into `Supabase/` (see that
  folder's README for the `supabase` CLI commands) so they're
  version-controlled alongside the client.
- Add email confirmation / SSO in Supabase Auth settings if this goes to
  production (currently plain email+password).
- Set up a scheduled job to purge or archive very old `scan_events` rows if
  scan volume gets large; `employees.scan_logs` and `employees.remarks_log`
  are unbounded jsonb and should also get an archival/trim policy at scale.
  **`scan_events` done 2026-09-30** (`archive_old_scan_events()`, daily
  `pg_cron`, see Supabase/README.md's change log). **`employees.scan_logs`
  done 2026-10-01** (`trim_employee_scan_logs()`, daily `pg_cron`, plus a
  prerequisite fix — `employees.scan_parity_count` — so trimming it can't
  silently flip IN/OUT direction; see Supabase/README.md's change log for
  both). `employees.remarks_log` is still open — 40 entries total across
  723 employees as of 2026-10-01, not yet a real growth problem.
- Replace the placeholder SVGs in `Public/Assets/Favicon` and
  `Public/Assets/Icon` with real brand assets.
- The kiosk's Supabase session token still needs network to silently
  refresh (default ~1hr expiry) — offline scanning and app-shell loading
  now survive a real outage (see `Supabase/README.md`'s "Offline
  scanning"), but a kiosk offline *longer* than its token's lifetime could
  still get signed out. Consider a longer JWT expiry for scanner-only
  accounts specifically (Supabase Auth settings) if outages routinely run
  longer than an hour.
- **Time-limited proximity cards** (contractor/visitor badges that expire
  automatically instead of needing a manual revoke) — not started.
  Full design, a daily `pg_cron` job following the same convention as the
  scan-data archival and scan-log trim jobs, and a checklist are in
  `expiring-proximity-cards-plan.md` at the repo root. Delete that file
  and update this bullet once it ships.
- ~~Proactive "scanner went silent" alerting~~ — **done 2026-10-02**
  (`check_scanner_silence()`, every-15-minute `pg_cron`, Settings →
  "Scanner silence alerts" — see this section's change log entry and
  `Supabase/README.md`'s matching one). `scanner-silence-alerts-plan.md`
  deleted per its own checklist.

---
*Last reconciled against the live GitHub repo and live Supabase project on
2026-10-02. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*

### Change log (most recent first)

**2026-10-05 (quota deadline) — Supabase exit runbook, and the reason it may not be needed**
- The org went over its Free-plan egress quota (7.779 GB against 5 GB) and the
  grace period ends **03 Nov 2026**, after which requests return HTTP 402.
  `docs/SUPABASE_QUOTA_DECISION.md` is the decision brief (whether/when);
  `docs/SUPABASE_EXIT_RUNBOOK.md` is the staged cutover runbook (how).
- **Read the banner precisely.** It restricts *"if your organization remains
  over quota"*, and 402 means requests are refused — not that the project is
  deleted or paused (those are different mechanisms with different recovery
  paths). The risk being managed is "the app stops serving", not "the data is
  gone", and the trigger is conditional: get back under 5 GB and it does not
  fire.
- **The likely resolution was already shipped and is probably inert.** The
  egress migration from pass 3 (`20261005000000_…`, commit `5a1d49e`) targets
  the dominant source — the per-kiosk whole-roster refresh (~3.7 GB/cycle per
  kiosk) and the Dashboard's double roster download. Verified 2026-10-05: **no
  workflow in `.github/workflows/` applies migrations** — `deploy-supabase.yml`
  fires only on `Supabase/functions/**` and deploys only Edge Functions. Both
  clients fall back to the old RPCs on `PGRST202`, which is exactly the state
  an unapplied migration produces. So the fix is live in the browser and
  absent from the database, and egress is still running at the old rate.
  Applying that one file is the first thing to try.
- Recommendation: apply the migration and re-measure with the Usage filter set
  to **Proximity** rather than *All projects* (the 7.779 GB has never been
  attributed to a single project); buy Pro (~$25/mo, 250 GB) as an immediate
  safety net regardless, because it converts a hard deadline into no deadline.
  Do **not** run an emergency platform migration to resolve a $25 bill — for an
  access-control system, a rushed cutover means nobody badges in.
- **P0 regardless of the option chosen:** `Supabase/local/export-project.sh`
  takes a complete, read-only, restorable capture — schema (three forms), data,
  `auth.users`, roles, extensions, every function definition, RLS policies,
  triggers, live migration history, pg_cron jobs, realtime publication, storage
  bucket config and object listing, and row counts for restore verification. It
  writes a `MANIFEST.md` naming what it could not capture (storage object bytes,
  Edge Function source, secrets, auth provider config) so a partial capture
  can't be mistaken for a complete one.
- **The backup doubles as the Phase 0 schema reconciliation.** Its
  `inventory/public-functions.sql` contains every live function definition —
  including the nine RPCs and the `alerts`/`scanners` tables that
  `test/schema-drift.test.mjs` currently allowlists as missing. Capture once,
  use for both; then delete the allowlist entries as each migration lands.

**2026-10-05 (architecture) — local-database/sync proposal, and the blocker it uncovered**
- On branch `architecture/local-database-sync`, not merged: new
  `docs/LOCAL_DATABASE_ARCHITECTURE.md` proposing one local PostgreSQL per
  **site** (not per device), a local API as the security boundary, a durable
  transactional outbox, and idempotent append-only scan sync to a central
  PostgreSQL. Keeps PostgreSQL — the app leans on RLS, `SECURITY DEFINER`
  RPCs, triggers, `jsonb`, `pg_cron` and views, so an engine change would be a
  backend rewrite bought for nothing. Nothing is implemented.
- **The finding that reorders the plan: this repository cannot build its own
  database.** Applying `Supabase/migrations/*.sql` in order to an empty
  PostgreSQL *fails* — `20261002000000_scanner_silence_alerts.sql` calls
  `public.raise_alert()` and reads `public.scanners` / `public.alerts`, and no
  migration creates any of the three. Separately, nine RPCs the client calls
  (`get_dashboard_stats`, `get_onsite_roster`, `get_alerts`,
  `get_unread_alert_count`, `acknowledge_alert`, `acknowledge_all_alerts`,
  `get_scanners`, `update_scanner`, `get_scanner_performance_stats`) have no
  source in the repo at all, and the committed `scan_proximity_code()` is
  behind live (it has no `scanners` upsert, which `Supabase/README.md`
  documents as existing). Every phase of the local-database plan starts with
  "stand up the schema from the repo", so this is Phase 0, ahead of any sync
  work.
- This is the predicted consequence of something `.github/AI_REVIEW.md`
  already warned about: the AI review only sees a PR diff, so schema applied
  straight to the project (via MCP) is structurally invisible to it.
  `Supabase/README.md`'s change log records the same "backend shipped, no
  migration file" pattern four separate times.
- **Now enforced rather than just documented**: `test/schema-drift.test.mjs`
  (5 cases) cross-checks every RPC called from `JS/` and every `public.<object>`
  a migration references against what the migrations actually create. Current
  drift is pinned in an explicit allowlist so `npm test` stays green while it's
  paid down; new drift fails CI immediately, and reconciling an object forces
  its allowlist entry to be deleted (a staleness check asserts that). Verified
  by removing an entry and confirming the failure names the exact object.
  Suite is now 48 passing.
- `Supabase/local/apply-migrations.sh` applies the migrations in order against
  a `supabase start` stack (or any `postgresql://` URL), stopping at the first
  failure and naming the file. Phase 0 deliberately uses the Supabase CLI stack
  rather than a bare `postgres:17` container: the schema depends on the
  anon/authenticated/service_role roles, the `auth` schema behind `auth.uid()`,
  `storage.*` for the scan-sounds bucket, and `pg_cron`/`pg_stat_statements`.
  Validate the migrations first; replace the platform surface later, as its own
  phase, so a migration bug can't be confused with a compatibility-shim bug.

**2026-10-05 (pass 3) — the actual egress bill: two unconditional whole-dataset polls**
- Passes 1 and 2 shrank what a *scan* costs. They explicitly left open what
  turned out to be the dominant cost, which is not per-scan at all: two
  timers that re-download an entire dataset on a fixed interval whether or
  not anything changed.
  - **Scanner lookup cache** — `get_scanner_offline_cache_compact()` every
    5 minutes per kiosk, returning the whole card roster each time. At the
    729 employees and ~0.6 KB/employee this file already recorded, that is
    ~430 KB × 288 calls = **~125 MB/day per kiosk, ~3.7 GB per billing
    cycle per kiosk** — nearly all of it bytes the kiosk already had.
  - **Dashboard** — `get_dashboard_stats()` *and* `get_onsite_roster()`
    every 30 s per open tab. `get_onsite_roster(16)` was measured at 272
    rows, and the stats object additionally carries an `on_site[]` array
    that is a second copy of that same roster which `DashboardPage.js` has
    never read (it derives every on-site number from the roster itself via
    `summarizeRoster()`), plus a `by_department[]` it recomputes locally.
    So the page downloaded the roster roughly twice, 2,880 times a day, per
    open tab.
- **Fix: make both conditional.** New migration
  `Supabase/migrations/20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql`
  adds `get_scanner_offline_cache_delta(p_since, p_known_digest)` and
  `get_dashboard_pulse(p_window_hours)`. Nothing existing is dropped or
  altered, and both clients fall back to the previous RPCs on `PGRST202`, so
  a client deploy landing before the migration degrades to today's behaviour
  instead of breaking.
  - The scanner now sends back the previous response's cursor + roster
    digest and receives only the employees updated since (in a 5-minute
    window: the handful of people who actually scanned). Two change signals
    rather than one, because `employees` has an `updated_at` that every scan
    bumps, while `proximity_cards` has no timestamp at all — card
    issue/delete/revoke/reassign is covered by a digest whose mismatch forces
    one full resync. Deletions therefore need no `removed[]` list.
  - The dashboard polls `get_dashboard_pulse()` (stats minus the two array
    fields nothing reads, plus a cheap roster version) and only refetches
    the roster when that version changed — plus a forced refetch every 5
    minutes, because `is_stale` flips with nothing but the passage of time
    and no data version can observe that. Clicking **Refresh** always forces.
- Two smaller cuts in the same pass: the alerts badge no longer polls while
  the tab is hidden (it caught up on `visibilitychange` already being the
  pattern used by the Dashboard), and `employee_directory` is now fetched
  with an explicit column list instead of `select('*')` — dropping
  `last_scan` (a whole jsonb scan-log entry per employee, the heaviest
  column in the view), `total_remarks`, `created_at` and `updated_at`, none
  of which the grid, the edit modal or the XLSX export read.
- New pure helper `mergeLookupDelta()` in `JS/Core/offlineScanning.js`,
  covered by six cases in `test/offline-scanning.test.mjs` (full replaces,
  incremental overlays in place, empty is a no-op, an unknown code is
  appended rather than dropped, a missing cache degrades safely, and merged
  rows still classify identically). Full suite: 43 passing.
- **Not measured against the live project.** The Supabase credentials
  available in this session do not include the Proximity project
  (`kjwttqmbcjvkivgmwuev`), so these numbers come from the repository plus
  the row counts and payload sizes earlier sessions recorded in
  `Supabase/README.md`, not from a fresh query or the API logs. Apply the
  migration first, then compare **project-filtered** (not "All projects")
  uncached egress after the next usage refresh before attributing what
  remains.

**2026-10-03 (pass 2) — scanner no longer downloads thumbnails per scan or per feed refresh**
- After the first egress pass, live measurements showed thumbnails were still
  ~92% of every scan response (~9.3 KB) and every Recent Activity load
  (~88 KB per 10 rows). The standalone scanner now asks for responses
  without photos (`scan_proximity_code_compact(..., p_include_photo => false)`,
  new `get_scan_feed_compact()`) and renders thumbnails from its local
  IndexedDB photo cache: one scan ≈ 0.5 KB, one feed load ≈ 2.6 KB.
  Offline-queue replay no longer downloads a thumbnail per queued scan
  either. Scan responses also stopped carrying `email`, `phone` and audit
  columns (explicit field allowlist).
- `OfflineScanModel.withCachedPhoto()` re-attaches the cached thumbnail and
  syncs the photo cache immediately (throttled) when the scanned employee
  has a photo the kiosk lacks or an out-of-date one. New pure helpers
  `attachCachedPhoto()` / `photoNeedsRefresh()` in `JS/Core/offlineScanning.js`
  are covered by `test/offline-scanning.test.mjs`.
- Deploy order: the database migration
  (`Supabase/migrations/20261003083051_scan_payload_photo_split.sql`) is
  already live and backward compatible, so merging this client change is
  safe at any time; older cached clients keep using the legacy
  `get_scan_feed()` until it is dropped in a follow-up.
- Also closed an `anon` execute grant on `revoke_proximity_card()` and
  documented live-vs-repo migration history drift — full details in
  `Supabase/README.md`'s change log.

**2026-10-03 — Supabase egress investigation and scan-response reduction**
- The billing screenshot is filtered to **All projects**, so its 6.34 GB
  total egress (about 0.01 GB cached) is organization-wide, not attributable
  to Proximity. Repository review found the scan RPC returned
  `to_jsonb(employee)`
  on every successful scan, including the growing `scan_logs` history, and
  the standalone scanner fetched the latest 10 feed rows (with thumbnails)
  again after each matched scan. Its 30-minute offline-photo refresh also
  downloaded every thumbnail on every pass. The dashboard refreshed both
  stats and roster every 30 seconds, including while its browser tab was
  hidden.
- Reduced scan RPC responses to omit scan history and resolved remarks,
  made offline photo refreshes incremental by `photo_file_id`, prepended
  matched scans already returned by the RPC instead of downloading the feed
  again, and stopped dashboard polling while the tab is hidden.
- Select the Proximity project in Supabase Usage before measuring the
  effect. The screenshot alone cannot establish how much of the total these
  paths contribute. `Supabase/migrations/20261003025504_reduce_scan_rpc_payloads.sql`
  must be applied to the live project before deploying the client changes;
  migration history and project-filtered usage should then be checked
  before attributing the remaining egress.

**2026-10-02 — Proactive "scanner went silent" alerting, implemented (plan from 2026-10-01)**
- **The backend (`check_scanner_silence()`, `get_scanner_silence_status()`,
  and the `check-scanner-silence` cron job) was already live on the
  Supabase project before this entry** — built directly against the
  database with no corresponding migration file, and no client-side work
  at all (the Alerts page already displayed any alert kind generically,
  including this one, via `alertKindLabel()`'s fallback — so alerts were
  silently already being raised with nowhere admin-facing to configure
  or check on them). This entry is both the migration-file reconciliation
  and the first commit of any kind for this feature.
- **One real bug found and fixed while verifying the live behavior
  instead of trusting it matched the plan**: both functions filtered on
  `scanners.last_seen_at is not null`, meant to exclude a scanner that
  "was provisioned but never scanned" (the plan's own stated rationale).
  That state is unreachable in this schema — `last_seen_at` is `NOT NULL`
  with a `DEFAULT now()`, and a `scanners` row is only ever created by
  `scan_proximity_code()`'s own upsert, which happens on a scan, not on
  any separate registration step. The check was always vacuously true
  and excluded nothing; removed, with the reasoning written into the
  migration directly so it isn't rediscovered the same way twice.
- Verified against live data, not just read: ran `check_scanner_silence()`
  twice in a row inside a rolled-back transaction, against synthetic
  enabled/disabled/under-threshold scanner rows — confirmed exactly one
  alert for the one scanner that should have been flagged (dedupe working
  across the two calls), and that disabled and under-threshold scanners
  were correctly excluded.
- New Settings → "Scanner silence alerts" panel, same place/pattern as
  "Scan data archival" and "Scan log trimming" right above it: a stat
  grid (silent now / enabled / total), last-scheduled-run status, and a
  "Check now" button for an on-demand run. New
  `JS/Models/ScannerSilenceModel.js`.
- `Supabase/migrations/20261002000000_scanner_silence_alerts.sql` —
  the committed migration this plan never got before now.
  No schema change needed — it reads fields `public.scanners` already has.
  Grounded against the live `scanners` table, `scannerState()`'s existing
  10-minute "online" window, `raise_alert()`'s dedupe parameters, and
  `alertKindLabel()`'s generic kind-to-label formatting before writing, so
  the plan is specific about why its alerting threshold must be a separate,
  much larger number than the panel's existing online/offline threshold,
  and why — unlike every `pg_cron` job in this app so far — it needs to run
  every 15 minutes rather than once a day. Written so another AI (or a
  future session) can implement it directly from the plan.

**2026-10-01 — Plan written: time-limited proximity cards; AI review config fixed**
- No code shipped in this entry — see `expiring-proximity-cards-plan.md`
  (repo root) for the proposed feature: proximity cards that carry an
  optional `expires_at` and auto-revoke on a daily `pg_cron` schedule,
  for contractor/visitor badges that today only ever expire if an admin
  remembers to revoke them manually. Grounded against the live
  `scan_proximity_code()`, `get_scanner_offline_cache()`, and
  `proximity_cards` schema before writing, and designed to reuse the
  existing `is_active`/`revoked_at` revoke path and the existing Alerts
  feature (`raise_alert()`) rather than introducing new state or a new
  notification channel. Written so another AI (or a future session) can
  implement it directly from the plan.
- Fixed `.github/workflows/ai-review.yml`, `.github/scripts/ai-review.mjs`,
  and `.github/AI_REVIEW.md`: all three referenced `claude-opus-5`, which
  is not a valid model string (the current Opus model is
  `claude-opus-5-5`) — the AI review job was almost certainly failing at
  the API call on every PR, not just reviewing poorly. Updated all three
  to `claude-opus-5-5`.

**2026-10-01 — `employees.scan_logs` trimming: a durable parity counter first, then a daily trim job**
- Same shape of problem as `scan_events` (unbounded, append-only jsonb,
  growing forever — 729 employees, 12,792 entries total, max 137 on one
  employee as of this writing) but a different fix, because `scan_logs`'
  array length was load-bearing: `trg_append_scan_log()` derived each new
  scan's IN/OUT direction from the parity of the array's *current length*,
  and the offline scanner mirrored the identical arithmetic client-side
  (`JS/Core/offlineScanning.js`, fed by `get_scanner_offline_cache()`'s
  `scan_count` field). Trimming old entries straight out of that array
  would have silently flipped every future scan's direction for every
  employee whose array just got shorter — a failure with no error, no
  crash, just the wrong badge forever after.
- **Fixed first, shipped and verified on its own, before any trimming
  code**: a new `employees.scan_parity_count` column that only ever
  increments, backfilled from each employee's scan count at migration
  time so the change is a no-op in effect — continuity, not a reset.
  `trg_append_scan_log()` and `get_scanner_offline_cache()` now read/write
  that counter instead of the array's length; `get_scanner_offline_cache()`
  keeps the field named `scan_count` on the wire specifically so
  `JS/Core/offlineScanning.js` needed **zero changes**, offline scanning
  included. `delete_employee_scan_log()` deliberately left alone — it
  already only removed one entry, and not touching the counter there means
  a deleted entry no longer shifts anything downstream at all.
- Verified directly against live data before moving on: a brand-new
  employee still alternates in/out/in from their first scan; an existing
  employee's next scan continued their exact pre-migration parity; a
  synthetic trim correctly left the counter untouched; an unprivileged
  caller is refused.
- **Then** `trim_employee_scan_logs()`: removes entries older than the
  retention window (default 180 days, floored at 90 like
  `archive_old_scan_events()`) straight out of each employee's array — no
  archive table needed here, unlike `scan_events`, since every entry
  carries a `scan_id` pointing back to a real `scan_events` row (now
  possibly in `scan_events_archive`), so nothing is lost that isn't
  already stored elsewhere. Scoped to employees who actually have
  something to trim. New daily `pg_cron` job (`trim-employee-scan-logs`,
  03:10 UTC — 10 minutes after the archival job so the two don't start at
  the same instant).
- New Settings → "Scan log trimming" panel, same place and pattern as
  "Scan data archival" right above it: total entries, employees with
  history, the largest single history, the scheduled job's last run, and
  a "Run trim now" button. New `JS/Models/ScanLogsTrimModel.js`.
- `employees.remarks_log` deliberately not touched — same call as the
  `scan_events` archival pass made for it, for the same reason: 40 entries
  total, not a real problem yet, and unlike `scan_logs` it has no other
  copy anywhere, so trimming it for real would need its own archive table.
- Full RPC contracts, the parity-counter migration, and the verification
  steps are in `Supabase/README.md`'s matching entry.

**2026-09-30 — Scan-data archival job, on a daily schedule**
- `scan_events` had grown to 10,368 rows in 3 days of live use (~3,400/day)
  with no retention policy — this was on the roadmap as a "someday" item;
  the growth rate made it concrete. New table `scan_events_archive`, new
  functions `archive_old_scan_events()` / `get_scan_archive_status()`,
  `get_all_scan_events()` updated to read both tables so an admin's export
  still reaches old data — full detail in `Supabase/README.md`'s matching
  entry, including a real ambiguous-column bug (`#variable_conflict
  use_column`) caught and fixed before shipping, and the verification
  steps (a synthetic 200-day-old row, moved and confirmed end-to-end, then
  removed).
- New daily `pg_cron` job (`archive-old-scan-events`, 03:00 UTC) — this
  project's first use of `pg_cron`, not previously installed.
  180-day default retention is well past every other feature's own
  lookback (Attendance: 31 days; Scanner Analytics: 90), chosen
  specifically so the scheduled job can never remove a row any existing
  feature might still need; `archive_old_scan_events()` also floors its
  own argument at 90 so this can't be weakened by accident later.
- New Settings → "Scan data archival" panel (admin-only, same place and
  gate as "Query performance" next to it): live/archived counts, oldest
  live row, the scheduled job's last run, and a "Run archival now" button
  for an on-demand run. New `JS/Models/ScanArchiveModel.js`.
- Deliberately not touched: `employees.scan_logs` and
  `employees.remarks_log` — both still unbounded jsonb, both still on the
  roadmap above, neither a problem this pass solves (see that entry for
  why `scan_logs` specifically needs its own careful pass rather than
  reuse of this one).
- Also fixed in passing: a change-log entry from 2026-09-29 said the
  hover-preview feature's header was 300x300px while its own body text
  still said 100x100px (the code is 300 — only the prose had drifted).

**2026-09-29 — Employee Manager: hover a row's photo for a 300x300px preview**
- Hovering a row's photo in the Employee table now shows the same photo at
  300x300px in a floating preview, positioned next to the avatar (flips to
  the opposite side rather than running off the right edge of the window,
  and clamps vertically so a row near the top/bottom of a short window still
  gets a fully on-screen preview).
- **The actual ask** — that the 44px avatar's own column width and row
  height must not change — is what ruled out the obvious approach
  (`transform: scale()` on the avatar itself, or an absolutely-positioned
  element as a sibling within the cell): both stay inside the table's own
  layout and box model, and `.table-scroll` is `overflow:auto` (see
  `CSS/layout.css`), so anything `position:absolute` nested inside it gets
  clipped at the scroller's edge exactly the way an `<img>` would — a
  preview meant to sit "outside the column" can't actually render there
  from inside a clipped, scrolling ancestor. New `Utils/avatarPreview.js`
  instead appends a single floating element straight to `<body>`,
  `position:fixed`, entirely outside the table's DOM subtree and therefore
  outside both its layout (can never affect column width or row height —
  there's nothing left in the table to affect) and `.table-scroll`'s clip.
- Reuses the row's own already-loaded `<img src>` for the preview instead
  of requesting the photo a second time — same reasoning as the photo
  double-repaint fix a few entries below (2026-09-29 — Four small fixes):
  don't make the browser redo work it already did.
- Scoped narrowly on purpose: a new `.avatar-photo` class marks only
  Employee Manager's real-photo `<img>` (not the initials fallback, and not
  `avatarHTML()` itself, which several other places share —
  `ScanFeed.js`, `ScanResultCard.js`, `EmployeeModal.js` — none of which
  asked for or need a hover preview). Delegated listeners on
  `#dir-table-wrap` (call once per full `renderDirectory()`, same pattern
  as `wireCopyableCodes()`) so the preview keeps working after
  `paintDirectoryTable()` rebuilds the table body, without needing to be
  rewired on every repaint.
- Tests: no new pure logic to unit-test (this is DOM positioning, not a
  rule), so verified instead with a jsdom harness against the real modules
  outside the repo: exactly one `.avatar-photo` renders (only the row that
  actually has a photo); the preview element lives in `<body>`, not inside
  the table; the hovered row's own column width and row height are
  identical before and after hover; the preview flips sides near the
  viewport's right edge; it hides on `.table-scroll`'s own scroll event and
  on `mouseout`; hovering an initials-only avatar (no photo) never opens
  one; and navigating away and back (a fresh `renderDirectory()`, which
  recreates `#dir-table-wrap` from scratch) never leaves more than one
  `.avatar-preview` element behind in `<body>`.

**2026-09-29 — Four small fixes: department drill-down, photo reload, stat-card tooltips, password autofill**
- **Dashboard: "On site by department" is now clickable.** Each department
  in that summary line was plain text; it's now a `.dept-chip` button that
  opens `Components/DepartmentRosterModal.js` — a read-only list of exactly
  the live, active employees counted in that chip (same `filterRoster(...,
  { view: 'live' })` the chip's own number comes from, so the two can never
  disagree), with an .xlsx export. Purely a client-side filter of the
  roster `DashboardPage.js` already has loaded — no new RPC, no fetch.
- **Employee Manager: photos were being torn down and reloaded twice on
  every visit, even when nothing changed.** `renderDirectory()` always
  repainted the whole table twice per click — once immediately from
  `appState.employeesCache` (needed, so the page isn't blank while the
  fetch is in flight), then again once `EmployeesModel.listDirectory()`
  resolved, unconditionally, even when the fetch came back byte-for-byte
  identical to the cache (the common case: nobody else edited the roster
  between visits). Every repaint replaces `#dir-table-wrap`'s `innerHTML`,
  which destroys and recreates every `<img>`, so each visit re-fetched
  every visible photo from Google Drive twice regardless of whether
  anything actually changed. Fixed by comparing the fetch result against
  the cache (`JSON.stringify` equality) and skipping the second repaint
  when they match — down to one repaint per visit, and zero when nothing
  changed since last time. The very first repaint (from cache, before the
  fetch resolves) is unavoidable within this app's per-route
  `content.innerHTML` navigation model and wasn't touched. Verified with a
  jsdom harness against the real module: captured the `<img>` node
  reference mid-render (after the sync cache-paint, before the awaited
  fetch resolves) and confirmed it survives an unchanged fetch but is
  correctly replaced when the fetched data differs.
- **Attendance: hover text added to all five stat cards** (Employees,
  Employee-days, Total time on site, No OUT yet, Check times) — plain
  `title` attributes, same idiom already used elsewhere in this app (the
  "offline" scan badge, the unresolved-remarks toggle). Wording matches the
  explanatory paragraph already under the table.
- **Settings: Change password no longer invites the browser's own
  autofill/save-password prompt.** The 2026-09-28 fix below used the
  spec-correct `autocomplete="current-password"` specifically *to*
  cooperate with the browser's built-in password manager — which is
  exactly what a signed-in, unattended kiosk account doesn't want offered
  here. Current password's `autocomplete` is now `new-password` too (the
  standard, if unintuitive, cross-browser way to say "don't suggest a
  saved password, don't offer to save this one" — there's no dedicated
  token for that), and the hidden anchor `username` field is removed
  entirely, since it existed only to help the autofill it's now trying to
  suppress and its presence alongside a password field is part of what
  triggers Chrome's post-submit "Save this password?" prompt. The
  extension opt-outs (`data-lpignore`/`data-1p-ignore`/`data-bwignore`)
  are unchanged. Same caveat as before: not verified against a real
  browser + password-manager extension in this sandboxed environment.
- Ran the full test suite (32/32, unchanged — none of these four touch
  anything unit-tested) after all four changes, and smoke-tested each in a
  throwaway jsdom harness outside the repo: chip click → modal → correct
  row count and export enabled; the photo-repaint comparison above; the
  five tooltip strings render on their cards; the three password fields'
  `autocomplete` values and the removed hidden field.

**2026-09-28 — Three fixes: Alerts nav flash, Attendance's default date, password-manager interference**
- **Alerts always showed "Loading…" on nav click.** `renderAlerts()` had no
  `loaded` guard (every other page — Dashboard, Attendance, Audit Log — does),
  so switching to Alerts from the sidebar rebuilt `#al-body` as `Loading…`
  every single time, even when the last fetch was seconds old. `load()` is
  now split into `load()` (fetch) + `paint(rows)` (render from a cached
  `rowsCache`), matching the stale-while-revalidate pattern already used
  elsewhere: a repeat visit paints the cached rows instantly and refreshes
  underneath, instead of flashing empty.
- **Attendance's default range could go stale for a long-lived tab.**
  `let range = defaultRange()` ran once at module import — first page load —
  and was never recomputed after that except when "Run report" actually ran.
  Leave a tab open across midnight without ever touching the date pickers,
  and "today" silently kept meaning whatever day the tab happened to load.
  Fixed with a `userSetRange` flag: false until the user actually changes
  either date input (a `change` listener sets it), and every render
  recomputes `range = defaultRange()` from *today* until then — so the
  default always tracks the real current date, and stops doing so exactly
  once the user has picked their own range, which then survives navigating
  away and back (unchanged from before).
  Verified with a jsdom harness against the real modules (a stub
  `Core/supabaseClient.js`, not a live Supabase call): default before any
  interaction stayed pinned to "today" across two renders; picking a range
  and running the report, then re-rendering (simulating leaving the page and
  coming back), kept the picked range rather than reverting to today.
- **Change password: browser/extension autofill interference.** The fields
  already had the spec-correct `autocomplete="current-password"` /
  `"new-password"` tokens, but had no `name` attributes and weren't inside a
  `<form>` — both of which browser and password-manager-extension heuristics
  lean on alongside `autocomplete`, and third-party managers (LastPass,
  1Password, Bitwarden) are documented to disregard `new-password` outright
  and fill a saved current password into all three fields. Fixed: the three
  fields now sit in a real `<form>` with distinct `name`s, a hidden
  off-screen `username` field ahead of them (gives autofill heuristics a
  login-shaped anchor to key off instead of guessing), and
  `data-lpignore`/`data-1p-ignore`/`data-bwignore`/`data-form-type="other"` to
  opt out of the extensions that ignore the autocomplete spec. The Update
  button is now `type="submit"` with an explicit `submit` handler
  (`e.preventDefault()` then the existing save logic) so Enter in any field
  still submits instead of hard-reloading the page now that it's a real
  form. Not verified against an actual password manager extension — no
  browser with one installed in this environment — so treat this as the
  standard, well-documented mitigation rather than a confirmed fix; if a
  specific manager still misbehaves, say which one.
- Ran the full test suite (32/32) and re-checked every relative import
  resolves against its target's actual exports after all three changes.

**2026-09-28 — Dashboard: "On site now" table header now stays pinned**
- **Reported**: scrolling the roster scrolled the whole page and the column
  header went with it. **Root cause** (same one Attendance and Scanner
  Analytics had): the table sits inside a `.panel`, not directly under
  `#content`, so `.table-scroll` never got a bounded height. It grew to its
  full content height, never scrolled itself, and `#content` scrolled instead
  — leaving `thead th{position:sticky}` with no scroller to stick to (and the
  pagination bar pushed off-screen).
- **Fix, CSS + one id, no logic change**: `#dash-panel` (new id on the existing
  panel) is now the bounded flex column that takes the rest of the screen
  under the stat cards; only the row area scrolls, with the header, toolbar
  and pagination fixed in place (`CSS/layout.css`, next to the equivalent
  Attendance rule). The panel has a 320px floor so on a very short window
  `#content` scrolls instead of the panel's children overlapping.
- **Verified in a real browser, not assumed**: rendered the real
  `CSS/*.css` plus the panel markup (with 50 fake rows) in headless
  Chromium at 1920×945, 1280×720 and 1280×420, and measured. Before the fix:
  the table area does not scroll, `#content` does, pagination is off-screen.
  After: the table area scrolls (header offset stays at the container's top
  edge), `#content` does not scroll, pagination is visible at both larger
  sizes; at 1280×420 the 320px floor engages and `#content` scrolls, as
  designed. Caveat: this is a replica of the markup with static data, not the
  live page behind a Supabase login.
- Known trade-off: on a small laptop screen the stat cards wrap onto extra
  rows, which leaves the table area only a few rows tall (it still scrolls
  correctly). Compacting the cards would be a separate change.

**2026-09-28 — New pages: Dashboard and Alerts; new Settings panel: Scanners**
- **Why these three**: the live database already had the backend for all of
  them (`get_dashboard_stats`, `get_onsite_roster`, `get_alerts`,
  `get_unread_alert_count`, `acknowledge_alert`, `acknowledge_all_alerts`,
  `get_scanners`, `update_scanner`, plus the `alerts` and `scanners` tables)
  with no caller anywhere in the client — the same "backend shipped, UI never
  followed" gap the Audit Log and Scanner Analytics closed. No new migration
  was needed; the RPCs were exercised against the live project under an
  impersonated admin claim before wiring (stat keys, roster rows, alert
  shape and scanner rows all match what the pages read).
- **Dashboard** (`#dashboard`, admin/manager): on-site count, possibly-left
  (old IN) count, 24h scans + match rate, scanners online, unread alerts,
  open remarks, unassigned active cards; below them the on-site roster.
  Roster semantics deliberately match the server's own stats: only *active*
  employees count as on site or "possibly left"; an inactive employee whose
  last scan was an IN only shows under "Everyone with a last IN", so the
  headline never disagrees with `get_dashboard_stats().on_site_count`.
- **Alerts** (`#alerts`, admin/manager): inbox over `get_alerts()`, with an
  unread-count badge on the sidebar button (polled every 60s by
  `Core/alertsBadge.js`, started in `showShell()` and stopped in
  `showAuth()` so a sign-out never leaves a poller running). Alerts are raised
  server-side only; the client can only acknowledge, and acknowledged rows are
  kept (hidden by default, not deleted).
- **Settings → Scanners** (`Components/ScannersPanel.js`): every scanner seen,
  online/offline/disabled, last seen, 24h scans/matched/offline. Admins can set
  a label or enable/disable a scanner (`update_scanner()`, audit-logged as
  `scanner_updated`); anyone with Scanner scope gets a read-only view.
  Disabling flips `scanners.is_enabled`, which `scan_proximity_code()`
  already enforces: a disabled scanner's *live* scans are refused with "This
  scanner has been disabled by an administrator", while *offline replays* are
  still accepted (those swipes already happened, and refusing one would stall
  the kiosk's stop-on-first-failure sync queue).
- **Access rules** live in `Core/accessControl.js` (`canViewDashboard`,
  `canViewAlerts`, `canViewScannerRegistry`, `canEditScannerRegistry`) so
  they are unit-tested; every one is a UI convenience over the RPCs' own
  gates, which remain the real boundary.
- Tests: `test/dashboard.test.mjs` (9 new; suite is now 32). One of them
  failed on first run — my own new "inactive employee" fixture correctly
  showed up in an existing department filter — and the expectation was
  fixed, not the code.
- **Not changed, on purpose**: the default landing route is still Employee
  Manager (Dashboard is one click away), so existing bookmarks and the
  hash-restore behaviour are untouched.

**2026-09-28 — Settings: self-service "Change password"**
- New panel in Settings, visible to every signed-in account unconditionally
  — unlike "Scan sounds"/"Employee photos" below, this isn't gated by
  `settingsShowSounds()`/`settingsShowPhotos()` (or even `canViewSettings()`
  beyond Settings being reachable at all): changing your own password isn't
  tied to any module's access_scope, so every account that can reach
  Settings sees it, including a plain Viewer.
- `ProfilesModel.changePassword({ email, currentPassword, newPassword })` —
  re-authenticates via a second `supabase.auth.signInWithPassword()` call
  first, and only calls `supabase.auth.updateUser({ password })` if that
  succeeds. `updateUser()` on its own doesn't check the current password at
  all (a valid session is the only thing it verifies), which would let
  anyone at an unattended, already-signed-in session — a shared scanner
  kiosk left logged in, specifically, the device class this app actually
  runs on — silently change the password and lock the real owner out.
  Wrong current password surfaces as a plain "Current password is
  incorrect." rather than whatever raw error `signInWithPassword` returns.
- Deliberately does **not** go through the `admin-users` Edge Function —
  that function's `reset_password` action (`ResetPasswordModal.js`, Users &
  Roles) is for an *admin* setting *someone else's* password via the
  service-role key; this is a different, ordinary authenticated-user
  operation that Supabase's client SDK already supports directly, so
  routing it through a service-role function would add an unnecessary
  privileged code path for something that never needed one.
- A successful `updateUser()` fires a `USER_UPDATED` auth event that
  `main.js`'s `onAuthStateChange` listener doesn't special-case (unlike
  `TOKEN_REFRESHED` or a same-user `SIGNED_IN` — see that listener's own
  comments), so it falls through to a full `boot()`/`showShell()`
  re-render of whatever page is open. Harmless here (Settings just
  redraws itself right after its own success toast) — noted rather than
  "fixed" since threading a new special case into that shared listener
  for one cosmetic redraw isn't worth the added surface area.

**2026-09-28 — Scanner Analytics: range buttons moved into the Daily trend panel**
- The 7d/14d/30d/90d buttons now sit at the top-right of the Daily trend
  panel header instead of in a toolbar above the stat cards; the empty
  toolbar was removed with them, so the page now opens straight on the
  stat cards. They still drive the *whole* page (stat cards, chart and
  by-scanner table all read the same `selectedDays`), only their position
  changed — worth knowing if the placement ever reads as "trend only".
- Because the panel is rebuilt by `paintBody()` on every fetch, the
  buttons are wired by delegation on `#analytics-body` (`onRangeClick`)
  rather than per-button in the page shell. The error state also renders
  the buttons: they're no longer in the shell, so without that a failed
  range (e.g. 90d) would leave no way to pick another one.
- New reusable `.panel-head` (`CSS/components.css`): title block on the
  left, a control group on the right, wrapping under the title on narrow
  screens.

**2026-09-28 — Attendance: one-row toolbar; small shared scrollbar**
- **Attendance toolbar** now matches Employee Manager and Proximity
  Cards: search, department and status on the left; From/To dates, Run
  report and Export on the right, all in one `.toolbar` row. Previously
  the dates/buttons sat in their own row above the stat cards and the
  search/department/status filters were rebuilt inside `#att-body`,
  underneath them.
- **Structural change behind it** (`AttendancePage.js`): the filters moved
  out of `paintBody()` into the persistent page shell. Nothing that
  matters to the user changes, but `paintBody()` no longer replaces the
  search `<input>` (so typing can't lose focus), the three filter
  handlers are wired once in `renderAttendance()` instead of on every
  paint, and `paintBody()` now only refreshes the department `<option>`s
  from the loaded report (down to just "All departments" if a range comes
  back empty). The filters now stay visible on an empty range too.
- **Small scrollbar**: one shared rule in `CSS/components.css` styles
  every scroller in the app (tables, modals, sidebar, page) as thin with
  a transparent track and muted thumb, using the theme tokens so it
  follows light/dark. Standard `scrollbar-width`/`scrollbar-color` plus
  `::-webkit-scrollbar` fallbacks for older Chromium/Safari.
- Known, pre-existing and left as-is: typing in the search box repaints
  only the table, not the stat cards, so the summary numbers don't follow
  the search text until a department/status change repaints them.

**2026-09-28 — Sticky table headers on Attendance and Scanner Analytics**
- Reported: unlike Employee Manager and Proximity Cards, the header row
  scrolled away on both pages. Root cause: `.table-scroll thead th
  {position:sticky}` (`CSS/layout.css`) only works when `.table-scroll`
  is itself the scroller. On the table-first pages it's a direct child of
  `#content` (a bounded flex column), so it absorbs the overflow and
  scrolls. Attendance and Analytics nest the table one level deeper
  (`#att-body`, and `.panel` inside `#analytics-body`), so `.table-scroll`
  never got a bounded height, grew to full content height, and `#content`
  scrolled instead — leaving the sticky header nothing to stick to.
- Fixed with CSS only (`CSS/layout.css`, no markup/JS change):
  `#att-body` is now a bounded flex column so its table area scrolls with
  the stat cards, filters and pagination pinned around it; Analytics'
  by-scanner table gets a `max-height: min(420px, 50dvh)` instead, since
  it shares a long page with stat cards and a chart and can't fill "the
  rest of the screen" the way a table-first page does.

**2026-09-28 — Date ranges: an inverted from/to now swaps instead of overwriting**
- Picking a "from" later than the "to" (or a "to" earlier than the "from")
  used to overwrite the *other* date with the one just picked, silently
  discarding a date the person had chosen. It now swaps the two, so from
  28/09/2026 then to 21/09/2026 becomes from 21/09/2026, to 28/09/2026.
  An empty end, or a same-day range, is left alone.
- The same clamp was copy-pasted in three places (`AttendancePage.js`,
  `ExportScanLogsModal.js`, `ScanLogModal.js`); all three now call one
  helper, `Utils/dateRange.js` (`orderDateRange()` plus
  `wireDateRangeOrdering(fromEl, toEl, onChange)`), so a future date-range
  field gets the behaviour by calling it once. Behaviour is otherwise
  unchanged — Attendance's own 31-day cap and `validateRange()` still apply.
- Client-only: no schema, RPC or dependency change.
- Tests: `test/date-range.test.mjs` (5 new; suite is now 24) — the swap,
  a year boundary, same-day/empty ranges, both change directions on stand-in
  inputs, and a null element. A throwaway jsdom run against the real
  Attendance page confirmed the swapped dates are what the RPC receives.

**2026-09-28 — Scanner Analytics: click a stat card or scanner to see the scans behind it**
- Every stat card on Scanner Analytics (Total, Matched, Unmatched when
  present, Inactive card, Inactive employee, Unassigned card, Captured
  offline) now opens a details dialog listing the actual scans that card
  counted — time, employee (name, code, department), card, scanner, result,
  an "offline" tag — newest first, with Export .xlsx. Rows in the By scanner
  table do the same for that one scanner. Cards showing 0 stay plain (nothing
  behind them); cards and rows are keyboard-operable (Tab, Enter/Space).
- The dialog uses the window the *displayed* numbers were loaded for
  (`stats.summary.days`), not the highlighted range button, so clicking a card
  right after switching 7d → 30d still lists what that card was counting.
- Read-only, so the page's "nothing here can be edited" promise still holds
  (no delete affordance, unlike `ScanLogModal.js`).
- New: `Components/ScanDetailsModal.js`, `Utils/scanDetails.js`,
  `ScannerStatsModel.details()`, and the `get_scanner_scan_details()` RPC
  (`Supabase/migrations/20260928080000_scanner_analytics_drilldown.sql`;
  gate, window and contract in `Supabase/README.md`). Small CSS additions in
  `CSS/components.css` (`.stat-card.clickable`, `.clickable-row`). No new
  dependencies.
- Tests: `test/scan-details.test.mjs` (5 new; suite is now 19), including one
  that fails if the UI's filter list drifts from the RPC's. A throwaway jsdom
  harness outside the repo also exercised the real page + modal: click and
  Enter/Space activation, zero-count cards inert, employee names and a
  scanner id shaped like `<img onerror>` rendered as text, the RPC arguments
  sent, close behaviour.
- Live/repo drift found on the way (undocumented live RPCs with no UI, and
  migrations applied live but not committed) is written up in
  `Supabase/README.md`'s 2026-09-28 entry.

**2026-09-28 — New page: Attendance (+ an Analytics correction)**
- New route `attendance`, admin/manager only — the same gate as
  "Export all scan logs", because it is that same per-employee history,
  aggregated. New `canViewAttendance()` in `Core/accessControl.js` (mirrors
  `is_admin_or_manager()`), wired through `state.js`, `screens.js` (nav
  visibility + route fallback), `router.js`, and `index.html`.
- New `Features/Attendance/AttendancePage.js`, `Models/AttendanceModel.js`,
  and pure `Utils/attendance.js`, over the new `get_attendance_report()`
  RPC (`Supabase/migrations/20260928000000_attendance_report.sql` — full
  contract and design notes in `Supabase/README.md`). Default window is the
  last 7 days; range is capped at 31 days client-side *and* server-side.
  Stat cards, name/department/status filters, pagination, and an .xlsx
  export of every row matching the filters (labelled with the range the
  data was actually loaded for, not whatever the date inputs say after an
  un-run edit). A superseded slow response is dropped rather than allowed to
  overwrite a newer one.
- Why derived from `scan_logs` and not `scan_events`: direction isn't a
  column anywhere but `employees.scan_logs` — `trg_append_scan_log()`
  assigns it from the log's length parity at insert time. Pairing follows
  that sequence, not timestamps, so a backdated offline sync can't invert a
  pair.
- Tests: `test/attendance.test.mjs` (8 new; suite is now 14) covers the
  permission rule and every pure helper, including a DST-spanning range.
  Rendering was smoke-tested in a throwaway jsdom harness outside the repo
  (permission guard, XSS escaping of names, filters, bad-range and server
  error paths, empty state).
- **Correction to 2026-09-26's Analytics page:** its "Unmatched" card could
  only ever read 0 — `scan_proximity_code()` never stores unmatched scans
  (`Supabase/README.md`'s `scan_events` row was wrong about this and is
  fixed). The card now appears only if such rows exist, and a one-line note
  explains the gap otherwise. Whether unmatched scans *should* be stored
  is left open for the owner — see `Supabase/README.md`'s 2026-09-28 entry.

**2026-09-26 — New page: Scanner Analytics**
- New route `analytics`, gated by the same `canViewScanner()` boundary as
  Test Scan/Scanner — admins and any account with `access_scope` `all` or
  `scanner`. New nav entry between Test Scan and Users & Roles.
- New `Features/Analytics/AnalyticsPage.js` + `Models/ScannerStatsModel.js`,
  built entirely over `get_scanner_performance_stats()` — a `SECURITY
  DEFINER` RPC that was already live and correctly secured on the database
  from an earlier session, with no caller anywhere in the client and no
  mention in `Supabase/README.md` until now. Same "backend shipped, UI
  never followed up" gap as the Audit Log's 2026-09-21 entry — found by
  cross-checking `list_tables`/`get_advisors` against the repo before
  starting new work, not by guessing at a new feature from scratch.
- 7/14/30/90-day range picker (matches the RPC's own `p_days` clamp);
  summary stat cards (total scans, matched with a match-rate percentage,
  and a count for every other `result` value, plus offline-captured
  scans); a dependency-free daily trend chart (plain divs, inline-sized —
  no canvas or charting library, same stance as the rest of this app);
  and a by-scanner table (total, matched, match rate, last scan).
- No schema, RLS, or grant changes — the RPC's own internal permission
  check was already correct; re-ran `get_advisors` (security) before
  wiring a caller to confirm nothing regressed. See `Supabase/README.md`'s
  matching change log entry for the full RPC contract now documented
  there for the first time.

**2026-09-25 — Employee Manager: "Export all scan logs" date range moved into its own modal**
- The two date inputs for scoping a scan-log export used to sit
  permanently in the toolbar next to the button itself — taking up space
  on every visit for what's an occasional action, and doing nothing for
  the common case (export everything, no range) beyond sitting there
  empty. New `Components/ExportScanLogsModal.js` follows the same
  "modal owns the whole collect-input-then-act flow" pattern as
  `RevokeCardModal.js`: clicking "Export all scan logs" now opens a small
  modal with the From/To fields (same mutual-clamp behavior as before —
  picking one bound past the other pulls it along rather than producing a
  silently-inverted, always-empty range), and the actual fetch + `.xlsx`
  export happens from inside it.
- `DirectoryPage.js` lost the inline `#dir-scan-from`/`#dir-scan-to`
  inputs and their standalone change/click handlers entirely — the
  toolbar now just opens the modal. `ScanEventsModel` and `fmtTime` were
  only ever used by that removed code path and are no longer imported
  here; `exportXlsx`/`todayStamp` stay, since the plain "Export" button
  (current page's visible rows, not the full scan history) still uses
  them directly.

**2026-09-24 — Employee Manager: edit-save no longer resets scroll position, page number, or the search box**
- Editing an employee and saving used `renderDirectory` — the full page
  render — as its post-save callback. That function rebuilds the ENTIRE
  toolbar via `content.innerHTML`, including a fresh, empty `#dir-search`
  input (losing whatever was typed), and explicitly resets `page = 1`.
  Destroying and recreating `.table-scroll` (the actual scrolling element)
  as a new DOM node also resets its scroll offset to 0, same as any full
  innerHTML replacement of a scrolled container would. Net effect: fix a
  typo on page 3, scrolled halfway down, and saving bounced you to the
  top of page 1 with your search cleared.
- Fixed with a new `refreshDirectoryInPlace()`, used only for the
  edit-save callback: refetches the roster, then repaints via
  `paintDirectoryTable()` alone — the same function a pagination click or
  typing in the search box already goes through today, neither of which
  ever had this problem, since it only replaces `#dir-table-wrap`'s own
  innerHTML. `.table-scroll` itself is never touched, so the browser
  preserves its scroll offset automatically — no manual save/restore
  needed. Add employee / Import / Delete all still use the full
  `renderDirectory()` — landing back on a clean page 1 is reasonable for
  those, where the fix would be disruptive for a routine single-field edit.

**2026-09-24 — Cloudflare Workers deploy: "Asset too large" build failure, fixed**
- No `wrangler.jsonc` had ever been committed, so Cloudflare's build
  re-ran its zero-config setup wizard on every deploy attempt, defaulting
  `assets.directory` to the entire repo root (`.`). Once Cloudflare's
  build environment runs `npm install` (triggered by `package.json`
  existing at all, for the test suite — see the "Automated tests" entry
  below), that root now includes `node_modules` — and wrangler's own
  dependency `workerd` ships a 127MB binary, well past the Workers 25MB
  per-file limit. Build failed with "Asset too large" on
  `node_modules/workerd/bin/workerd`.
- Fixed with two new files, not by narrowing `assets.directory`:
  `Public/index.html` loads `JS/`/`CSS/` as *siblings* (`../JS/main.js`),
  not children, so the deploy root genuinely has to stay the repo root
  for those relative paths to resolve — narrowing it to `Public/` alone
  would break the app. `wrangler.jsonc` now commits that root explicitly
  (stopping the wizard from re-running and re-guessing), and `.assetsignore`
  (gitignore-style syntax, read from the same directory as
  `assets.directory`) excludes everything that isn't actually part of the
  served app: `node_modules` (the actual blocker), plus `.git`, `.github`,
  `Supabase/`, `db-tests/`, `test/`, and other real-but-non-runtime files
  that have no reason being served from the public CDN either.
  `package.json` gained the `wrangler` devDependency and `deploy`/`preview`
  scripts Cloudflare's wizard wanted to add, committed properly instead
  of injected fresh on every build.

**2026-09-24 — Employee Manager: "Export all scan logs" + a real anon-grant gap caught mid-build**
- New toolbar button (admin/manager only, same gate as Import/Delete-all)
  exports the FULL `scan_events` history — every scan attempt, matched or
  not, across every employee — as one `.xlsx`, via a new `get_all_scan_events()`
  RPC. Deliberately not the existing per-employee "Export" button inside
  the Scan log modal (`ScanLogModal.js`, unchanged — still one employee at
  a time from their already-loaded `scan_logs`) and deliberately not
  `get_scan_feed()` with a huge `p_limit` either — see
  `Supabase/README.md`'s RPC section for why a full-org export earned its
  own purpose-built function instead of overloading the live-feed one.
- **Caught while building it, not after**: the new function's `REVOKE
  EXECUTE ... FROM PUBLIC` alone did NOT actually revoke `anon`'s access —
  verified with `has_function_privilege()` right after applying the
  migration, and it came back `true`. This project has a schema-level
  default privilege (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
  FUNCTIONS TO anon, authenticated`, standard on every new Supabase
  project) that applies automatically at `CREATE FUNCTION` time,
  independent of the `PUBLIC` pseudo-role — so revoking from `PUBLIC`
  clears the ambient "everyone" grant but NOT that separately-applied
  per-role one. Fixed with an explicit `REVOKE EXECUTE ... FROM anon`.
  Re-verified every previous session's "locked down" claim
  (`log_audit_event`, the 3 `trg_audit_*` functions) actually included
  `anon` explicitly too, not just `public`/`authenticated` — they did,
  confirmed via the same `has_function_privilege()` check — so this
  appears to be specific to how this one migration was originally
  written, not a systemic hole in the earlier fixes. Worth remembering
  for any future `REVOKE`, though: `FROM PUBLIC` is not equivalent to
  `FROM public, anon, authenticated` on this project.

**2026-09-21 — Sign-out no longer leaves a stale route hash in the URL bar**
- Reported: signing out landed correctly on the login screen, but the
  address bar kept showing whatever shell route was last open (e.g.
  `.../#directory`) instead of clearing. Root cause: `showAuth()`
  (`JS/Core/screens.js`) never touched `location.hash` at all — only
  `render()` (shell-only, called from `showShell()`) keeps the hash in
  sync with `appState.route`, and that path is never reached on
  sign-out.
- Fixed in `showAuth()` itself: clears the hash via
  `history.replaceState()` (keeping `location.pathname`/`search` as-is,
  notably including the standalone Scanner's own `?scanner=1` param —
  only the hash fragment is dropped).
- Same fix also closes a subtler, previously-unnoticed follow-on bug:
  `state.js` seeds `appState.route` from `location.hash` exactly once,
  at module load. On a shared browser, a stale admin-only hash left over
  from one account's sign-out could have silently routed the *next*
  sign-in (a different account, after a reload) straight to that
  admin-only page instead of the default landing route.

**2026-09-21 — Settings: "Query performance" panel (slow query logging + pg_stat_statements dashboard)**
- **Corrected a real gap left by an earlier, cut-off session**: it had
  already run `ALTER ROLE postgres SET log_min_duration_statement = 200`
  — but `postgres` is the role migrations/the SQL editor/MCP tooling
  connect as, **never** the role the live app's own traffic runs as.
  PostgREST connects as `authenticator` and impersonates (`SET ROLE`)
  into `anon`/`authenticated` per request based on the caller's JWT; per
  PostgREST 11.1's "Impersonated Role Settings" (Supabase's own
  documented pattern — they use it for `statement_timeout`, this project
  already had `anon`: 3s / `authenticated`: 8s set that way before this
  change), a role-level `ALTER ROLE … SET` only takes effect for a
  request when it's set on the *impersonated* role, not `authenticator`
  or `postgres`. So the earlier setting was silently logging nothing for
  actual app requests. Fixed by also setting it on `anon`,
  `authenticated`, and `service_role` (200ms — same value, correct
  roles), and reloading PostgREST's config cache (`NOTIFY pgrst, 'reload
  config'`) so the fix actually took effect rather than sitting cached.
- `log_min_duration_statement` writes to the Postgres log (viewable in
  the Supabase Dashboard's Logs Explorer) — good for raw "here's a slow
  request as it happens" visibility, but log text isn't something the
  app can query and turn into a dashboard. That's what
  `pg_stat_statements` is for — already enabled on this project
  (confirmed already accumulating real stats — 1,458+ rows — despite
  being completely unused until now) and directly SQL-queryable. New
  RPCs `get_slow_query_stats(p_threshold_ms, p_limit)` and
  `reset_slow_query_stats()` (admin-only, see `Supabase/README.md`) sit
  on top of it.
- New "Query performance" panel in Settings
  (`JS/Features/Settings/SettingsPage.js`) — unconditionally admin-only
  (`isAdmin()` directly, not the `settingsShowSounds()`/`settingsShowPhotos()`
  scope helpers the other two panels use): an adjustable threshold
  (default 200ms, matching the DB-side default above), a table of every
  query shape averaging at or above it — Calls ("how often"), Total time
  = Calls × Mean ("how much resource", the real cumulative load, which a
  single slow-but-rare query wouldn't show on its own), Max, Rows, and
  cache-hit % — and a Reset stats button (with a confirm dialog; it's
  instance-wide, not scoped to what's currently shown).
- Filtered to the app's own `anon`/`authenticated`/`service_role`
  traffic, not raw `pg_stat_statements` — a managed-Postgres instance's
  unfiltered stats are dominated by Supabase's own internal housekeeping
  (Realtime, background workers, the SQL editor itself running as
  `postgres`) which would drown out anything actually actionable here.
- New `JS/Models/QueryStatsModel.js` — thin wrapper, same "the RPC is the
  real gate" pattern as `AuditLogModel.js`.
- Verified end-to-end against the live project rather than assumed:
  confirmed the corrected role settings actually landed
  (`pg_roles.rolconfig`), confirmed grants (`anon` blocked,
  `authenticated` allowed, via `has_function_privilege()`), and ran the
  RPC's own underlying query directly — which immediately surfaced a
  real, pre-existing finding: the Employee Manager directory listing
  query was averaging ~230ms across nearly 2,000 calls, comfortably over
  the 200ms threshold. Not fixed as part of this change (out of scope —
  this feature is the *instrument*, not a query-tuning pass) but worth
  a follow-up look.

**2026-09-21 — Audit Log: new admin-only sidebar page (client-side; DB was already live)**
- The database side of this feature (`audit_log` table, `log_audit_event()`,
  `get_audit_log()`, 3 audit triggers, and a since-fixed permission gap on
  `log_audit_event()` itself) was already fully built, correct, and
  documented in `Supabase/README.md` as of an earlier session this same
  week — see that file's matching change log entry. What never got built,
  and had no files in this repo at all despite an earlier session's own
  transcript describing it as done, was the client side.
- New `JS/Models/AuditLogModel.js` + `JS/Features/Audit/AuditLogPage.js` —
  admin-only (both `isAdmin()` client-side and `get_audit_log()`'s own
  `where is_admin()` server-side), read-only table: Time / Actor / Event.
  `describeEvent()` turns each row's raw `{action, entity_type, detail}`
  into a sentence — one case per action the schema currently emits
  (`employee_deleted`, `proximity_card_deleted`, `card_revoked`,
  `remark_resolved`/`remark_reopened`, `scan_log_entry_deleted`,
  `account_changed`), plus a generic fallback for anything added later
  without a matching update here.
- `account_changed` entries always carry all three of
  `role`/`access_scope`/`is_active` as `{from, to}` pairs regardless of
  which one(s) actually changed (that's how `trg_audit_profile_changes`
  writes it) — `describeEvent()` filters to only the fields where
  `from !== to` before displaying, so an edit that only changed one of
  the three doesn't show two "X → X" no-op lines alongside it.
- Wired into `state.js` (`'audit'` added to `VALID_ROUTES`), `router.js`
  (title + dispatch), `screens.js` (nav visibility + folded into the same
  "land on the first route this account can actually see" fallback chain
  every other gated route already participates in), and a new sidebar
  button in the bottom rail next to Settings — both are admin-utility/
  oversight pages rather than core day-to-day workflow, unlike Employee
  Manager/Proximity Cards/Test Scan/Users & Roles above them.
- **Known gap, not fixed here** (documented in `Supabase/README.md`, not
  silently left out): `admin-users` never calls `log_audit_event()`, so
  creating an account, resetting a password, or deleting one leaves
  nothing in this log today — only a role/access_scope/is_active change
  does (via the trigger, independent of which caller made it).

**2026-09-21 — Settings: dark/light theme toggle**
- Added an "Appearance" panel to Settings — always visible regardless of
  access_scope (a personal display preference, not a privileged
  operation), unlike the Scan sounds / Employee photos panels below it.
  Dark stays the default — the app's only-ever-had-one look — with zero
  visual change for anyone who doesn't touch the toggle.
- `CSS/variables.css` gained a `:root[data-theme="light"]` override block
  for every design token, plus several new tokens (`--button-hover-*`,
  `--accent-hover`, `--accent-text-on-dim`, `--role-manager-*`,
  `--role-viewer-bg`, `--decorative-glow`) for colors that used to be
  hardcoded hex literals directly in base.css/components.css/auth.css/
  scanner.css — harmless with only one theme, but each one would have
  been a silent light-mode bug (a dark-navy decorative glow, unreadable
  role badges) if left as-is. The `*-dim` badge tokens (`--good-dim`,
  `--bad-dim`, etc.) flip relationship for light mode, not just lighten:
  dark mode pairs a dark tinted background with bright text
  (`.badge.matched`'s `background:var(--good-dim);color:var(--good)`);
  used as-is on white, several of those bright text colors fall short of
  WCAG AA contrast, so light mode pairs a pale tinted background with a
  deepened text color instead — same visual pattern, both ends swapped.
- `JS/Utils/theme.js` (new) is the shared source of truth for reading/
  writing the preference (`localStorage`, key `proximity-theme`) after
  the page has loaded — used by Settings' toggle. It is deliberately
  NOT what avoids a flash of the wrong theme on load for a returning
  light-mode user: it's an ES module, and this app's entire JS/main.js
  tree is `type="module"`, which defers until after the HTML is parsed
  and the browser may already be painting — too late. `Public/index.html`
  gained a tiny inline, non-module `<script>` as the very first thing in
  `<head>`, before the stylesheet link, duplicating just the
  read-localStorage-and-set-the-attribute logic synchronously.

**2026-09-21 — Google Drive token expiry handling, `.github` hardening, doc drift fixes**
- **Google Drive "token expired"**: the Edge Function already renews the
  short-lived access token silently; what expires is the long-lived
  *refresh token*, which Google will only re-issue after an interactive
  consent — there is no server-side way to renew it automatically. So the
  fix is two-sided: prevent it (OAuth consent screen must be **In
  production**, not Testing, which caps refresh tokens at 7 days) and make
  it obvious and quick to recover from. `upload-employee-photo` now returns
  HTTP 503 + `code: "google_reauth_required"` with an actionable message
  (Settings → Employee photos shows it too), logs Google's real error, and
  `Supabase/functions/upload-employee-photo/README.md` has a causes/prevention/
  re-issue runbook. Details: `Supabase/README.md`'s matching entry.
- **CI**: `deno check` was failing on current Deno (`Uint8Array` → `fetch`
  body typing in `concatBytes()`), which silently skips the deploy job —
  fixed; see `Supabase/README.md`.
- **`.github/scripts/ai-review.mjs`**: shell-injection fix (file names from a
  PR were interpolated into an `execSync()` command line on a runner holding
  `ANTHROPIC_API_KEY`; now `execFileSync` with argv), `-z` so non-ASCII file
  names aren't silently dropped from the review context, and vendored
  bundles / `.patch` / `.wav` / `.zip` excluded so they can't consume the
  diff budget (`Public/Vendor/*` alone can exceed it).
  `.github/scripts/setup-branch-protection.sh` now parses `origin` URLs
  without a trailing `.git`.
- **Docs**: `.github/DEPLOYMENT.md` said to run the frontend with
  `npx serve Public`, which contradicts §3 above (index.html references
  `../CSS` and `../JS`, and `/sw.js` lives at the repo root — serve the repo
  root); corrected. `.github/AI_REVIEW.md` gained a Limitations section.

**2026-09-19 — Offline remarks flag, Recent Activity IN/OUT, Scanner input no longer triggers Chrome's password UI**
- **Offline unresolved-remarks flag** — `ScanResultCard.js`'s ⚠ unresolved-remark
  banner already worked for a live scan (which gets `remarks_log` via
  `to_jsonb()` of the full employee row) — it read `e.remarks_log`
  generically and needed no changes at all. The gap was entirely in
  `JS/Models/OfflineScanModel.js#classify()`: `get_scanner_offline_cache()`
  has returned `remarks_log` on every row all along, but `classify()`'s
  employee object left it out, so a matched employee with an open remark
  silently showed no warning while the kiosk was offline. One field
  added, no RPC/schema change needed.
- **Recent Activity: IN/OUT badge** — `get_scan_feed()` has always
  returned `direction`; `JS/Components/ScanFeed.js`'s `feedRowHTML()`
  just wasn't rendering it. Added next to the result badge, same
  active/suspended styling as the result card's own IN/OUT badge.
  `prependPendingRow()` (the optimistic offline row) now passes
  `classifyResult.direction` through too, so a queued-but-not-yet-synced
  scan shows the same badge immediately rather than only after it syncs.
- **Scanner & Test Scan code inputs no longer trigger Chrome's autofill/
  "Update password?" prompts** — both `#ss-code` and `#ts-code` were
  `type="password"`, presumably to mask a manually-typed code from
  shoulder-surfing (no prior comment explained the choice, but that's a
  reasonable thing to want on a kiosk). Chrome deliberately **ignores**
  `autocomplete="off"` on `type="password"` fields specifically — a
  documented Chrome behavior, not a bug in this app — which is exactly
  why that attribute alone never suppressed the suggestions/save prompts.
  Switched both to `type="text"` with a new `.masked-code-input` CSS
  class (`-webkit-text-security: disc` — non-standard but supported by
  every Chromium/WebKit browser; this app is already Chrome-first by
  design, so the one real gap — Firefox falls back to plain, unmasked
  text, having no equivalent property at all — is an accepted trade-off,
  not silently broken masking). `autocomplete="off"` now actually works
  since it's no longer being overridden; added `autocorrect="off"`,
  `autocapitalize="off"`, `spellcheck="false"`, and
  `data-lpignore`/`data-1p-ignore` (LastPass/1Password's own
  ignore-this-field hints) alongside it for the same reason.
- **Self-correction, not a new bug**: earlier in this same session, before
  discovering the "Export to .xlsx ... + scan log entry delete" work
  below was already live from a different session, a
  `clear_employee_scan_log(p_employee_id)` RPC (whole-log nuke) was added
  as a first attempt at "add a delete button to the scan log." Once the
  already-deployed `delete_employee_scan_log(p_employee_id, p_scan_id)`
  (a properly-scoped per-*row* delete — see its own entry below) turned
  up, the whole-log version was strictly worse for the same need and
  nothing in the deployed frontend ever called it, so it was dropped
  rather than left as unused, confusing surface area in the database.

**2026-09-19 — Export to .xlsx (Employee Manager, Proximity Cards, Scan Log) + scan log entry delete**
- Vendored SheetJS `xlsx@0.18.5` (Apache-2.0) as `Public/Vendor/xlsx.mini.min.js`
  — the **mini** build (250KB) over the full build (881KB), since this app
  already cares about bundle size for kiosk/offline use; the only real
  omission is legacy-format support (XLS/XLSB/Lotus 1-2-3/SpreadsheetML
  2003) this app never reads or writes. Fetched via `npm pack xlsx`
  against `registry.npmjs.org` rather than `unpkg`/`cdn.sheetjs.com` —
  SheetJS stopped publishing new versions to npm/unpkg/cdnjs in mid-2024
  over an ongoing dispute with npm (see
  `github.com/SheetJS/sheetjs/issues/2822`), so 0.18.5 is the last npm
  release and will be the version here until a future upgrade fetches
  directly from SheetJS's new home. License text vendored alongside it as
  `xlsx.LICENSE.txt` per Apache-2.0's own attribution requirement. See
  `Vendor/README.md` for the full upgrade story.
- New `JS/Utils/xlsxExport.js` (`exportXlsx({filename, sheetName, columns,
  rows})`) — every export button below goes through this one function.
  Columns marked `text: true` get both `cell.t = 's'` (stops SheetJS
  itself writing a numeric cell type) and `cell.z = '@'`, Excel's "Text"
  number format (stops **Excel** re-interpreting an all-digit code like
  `"00091"` as a number the next time the file's opened or the cell's
  clicked into — `t: 's'` alone doesn't survive that round-trip). Applied
  to every proximity code / employee code column in every export below.
- **Employee Manager**: toolbar "Export .xlsx" button, visible to everyone
  who can see this page (it's read-only, not gated behind admin/manager
  like Import/Add/Delete are) — exports the *current search/filter view*,
  not the whole roster unconditionally. Columns: Name, Email, Employee
  code (text), Department, Position, Proximity ID (text), Status, Total
  scans.
- **Proximity Cards**: same pattern — toolbar "Export .xlsx", exports the
  current search/status-filter view. Columns: Proximity code (text),
  Assigned to, [assignee's] Employee code (text), Status, Issued.
- **Scan Log modal**: "Export .xlsx" button next to the title ("Scan log
  — [Name]"). Exports the full date/scanner-filtered set (`filtered` in
  `ScanLogModal.js`), not just the `RENDER_CAP`-limited 300 rows actually
  painted to the DOM — an export isn't constrained by DOM-rendering
  performance the way live painting is, so there's no reason to cap it
  the same way. Columns: Scanned at, Scanner, Direction, Proximity code
  (text), Recorded offline.
- **Scan Log modal, admin-only**: a small × delete button on each row.
  Backed by a new RPC, `delete_employee_scan_log(p_employee_id,
  p_scan_id)` (see `Supabase/README.md`) — deletes the real `scan_events`
  row *and* prunes the matching cached entry out of
  `employees.scan_logs` in one transaction, so Recent Activity and this
  log stay in sync rather than the cached copy silently drifting from
  the source of truth. Admin-only, both server-side (the RPC itself
  checks `is_admin()`, not just the client hiding the button) and at the
  same tier as deleting an employee or a card outright — stricter than
  the admin-or-manager bar the remarks-log add/resolve RPCs use, since
  this is an audit-trail correction, not a routine edit.
- **Known, accepted consequence of the delete above**: `direction`
  (IN/OUT) on every scan log entry is computed at *insert* time from
  `jsonb_array_length(scan_logs) % 2` (see `trg_append_scan_log()`) —
  deleting an entry shrinks that count and shifts the in/out parity of
  everything appended *after* it, the same way editing/removing a
  remark doesn't retroactively renumber anything else in that log. Not
  fixed here; recomputing every subsequent entry's direction on every
  delete would be a much bigger, riskier change for a correction feature
  whose whole point is fixing one wrong entry, not rewriting history.

**2026-09-19 — Removed self-service account creation; Enter submits sign-in**
- `Public/index.html` — the auth screen's Sign in / Create account tab
  toggle and the entire `#signup-form` are gone; the card is a single
  sign-in form now. `CSS/auth.css`'s now-dead `.auth-toggle` rules removed
  alongside it.
- `JS/Features/Auth/AuthScreen.js` — rewritten: no `signup-submit`
  handler, no tab-switching logic. Pressing **Enter** in either the email
  or password field now submits sign-in, same as clicking the button —
  there was no keyboard-submit path at all before this (no `<form>` tag
  is used here, deliberately, to avoid a real page navigation on submit —
  same reasoning as other in-app forms — so Enter needed an explicit
  handler rather than getting it for free).
- **Removing the button alone doesn't fully close this — said here
  plainly rather than left implicit**: `supabase.auth.signUp()` is a
  public method on the anon-key client; nothing stops someone from
  calling it directly (browser console, a raw `curl` against the
  Supabase Auth REST endpoint) even with the UI gone. Closing that
  requires **Supabase Dashboard → Authentication → Providers → Email →
  disable "Allow new users to sign up"** — a platform setting, not
  something reachable via `apply_migration`/`execute_sql` (Auth
  provider config isn't a Postgres table), so it wasn't flipped as part
  of this change. Worth doing if self-service sign-up should be
  impossible, not just hidden.
- **Bootstrap path changed as a result**: a brand-new deployment with an
  empty `profiles` table used to get its first (auto-admin) account
  through this now-removed sign-up form. `handle_new_auth_user()` itself
  is untouched and still auto-promotes whoever the first row in
  `profiles` turns out to be — it doesn't care which UI created the
  underlying `auth.users` row — so the fix is procedural, not code: create
  that first user via **Supabase Dashboard → Authentication → Users →
  Add user** instead, then sign in here with those credentials. See
  `## 3. Running it` above, updated to match.

**2026-09-19 — New root `index.html`: redirect stub to `Public/index.html`**
- The repo root had no `index.html` at all (confirmed via a direct
  `raw.githubusercontent.com` fetch — 404) — hitting the bare site root
  under any static host pointed at the repo root (GitHub Pages, a plain
  `npx serve .` with no path typed in) landed on a 404 or a raw directory
  listing instead of the app. New root `index.html` is a redirect-only
  stub to `Public/index.html` — see its own file-tree entry above for why
  it uses a relative redirect path rather than an absolute one, and why
  it must never grow real markup/logic of its own. `## 3. Running it`
  updated to match: no more "open the printed URL, then navigate to
  Public/index.html" — the bare root now gets you there directly.

**2026-09-19 — Scanner: hero photo progressively upgrades to full resolution when online**
- Complements, doesn't replace, the entry directly below this one (which
  fixed `photo_thumb_b64` itself going forward — 480px `.webp` instead of
  96px). That fix only applies to photos uploaded *after* it landed;
  existing rows keep their old 96px thumbnail — still visibly blurry at
  `.ss-photo-stage`'s `min(82dvh, 82dvw)` size — until someone re-uploads
  them. Rather than wait on that, `showHeroPhoto()` (`StandaloneScanner.js`)
  now shows `photo_thumb_b64` immediately as before (instant, always
  available, online or offline), then swaps to `photoUrl`'s full 512px
  Drive photo the moment that finishes loading, via a plain `<img>`
  preload. `photoUrl` is only ever present for an ONLINE scan
  (`scan_proximity_code()`'s `to_jsonb(employees)` response includes the
  full row; the offline lookup cache deliberately dropped `photo_url` as
  dead weight once nothing else read it — see the 2026-09-19 "Scanner
  responsiveness" entry and `Supabase/README.md`'s matching one) — so
  this is purely additive: if it never loads — offline, Drive
  unreachable, slow network — the thumbnail just keeps showing. Offline
  is unaffected either way; this only makes the ONLINE case actually
  sharp regardless of which thumbnail generation an employee's stored
  `photo_thumb_b64` came from. A small guard (`photoStage.contains(thumbImg)`)
  prevents a slow-loading upgrade from landing on the wrong photo if a
  newer scan has already replaced what's on screen by the time it
  finishes.
- **Existing rows still worth re-uploading eventually**: this doesn't
  backfill anyone's stored `photo_thumb_b64` — an employee whose photo
  predates the 480px fix below still shows the old 96px thumbnail
  *offline*, same as before. With current adoption this small (single
  digits), the practical fix is just re-saving each affected employee's
  photo once in Employee Manager — that alone regenerates the 480px
  `.webp` through the already-fixed pipeline. Not worth a one-off backfill
  script for a handful of rows; worth reconsidering if adoption grows
  enough that manual re-upload stops being practical.

**2026-09-19 — Scanner: blurry result photo, `photo_thumb_b64` guaranteed `.webp` going forward, result card moved off the empty spacer column**
- **Blurry photo, root cause:** the previous entry below moved the
  matched-scan photo into `.ss-photo-stage`, sized up to
  `min(82dvh, 82dvw)` — several hundred px on a real kiosk display — but
  `employees.photo_thumb_b64` was still a `sz=w96` Drive thumbnail. A 96px
  source stretched to fill most of the screen is exactly what "blurry"
  looks like; nothing was actually broken, the thumbnail was just sized
  for a badge-sized crop that no longer exists.
- **Fix, and the `.webp` ask, together:** rather than just bumping Drive's
  `sz=` param (Drive's `/thumbnail` endpoint doesn't support requesting a
  specific output format — it returns PNG or JPEG at its own discretion,
  which is *why* `offlineAvatarHTML()`/`photoDataUri()` had to sniff real
  magic bytes instead of trusting a label in the first place), added
  `Utils/image.js`'s `fileToOfflineThumbWebp()`: the same canvas-resize
  trick `fileToWebp()` already uses for the main photo, run a second time
  at 480px/`.webp` specifically for the offline thumbnail.
  `EmployeeModal.js` now generates both blobs when a file is picked and
  sends the thumbnail's base64 to `upload-employee-photo` alongside the
  main upload; the Edge Function stores it as-is, only falling back to its
  own server-side Drive fetch (bumped from `sz=w96` to `sz=w480` while
  touching that code, in case it's ever actually used) if the client
  didn't supply one. Every upload going forward is guaranteed `.webp` at a
  size that holds up at `.ss-photo-stage`'s scale; the sniffing in
  `photoDataUri()` stays as-is for the handful of rows stored before this
  change (still PNG/JPEG) and as a safety net for the fallback path.
- **Also fixed while in this code:** the main photo's `mime_type` was
  never actually sent to `upload-employee-photo` at all —
  `EmployeesModel.uploadPhoto()`'s request body simply didn't include it,
  despite the Edge Function's own header comment describing it as
  required-if-accurate. Harmless today (every browser this app has
  actually been tested on produces real `.webp`, matching the function's
  no-`mime_type` fallback), but silently wrong the moment `canvas.toBlob`
  falls back to a different format on some browser, which is precisely
  the failure mode `Utils/image.js`'s own header comment warns about.
  Threaded `pendingPhotoBlob.type` through `EmployeeModal.js` →
  `EmployeesModel.uploadPhoto()` → the request body so this can't drift
  again.
- **`#ss-result` moved to the grid's left column:** previously centered
  inside `.ss-main`, directly underneath where `.ss-photo-stage`'s
  full-viewport photo now renders on top of everything (`z-index:6`) —
  meaning the match/status text was effectively invisible right when it
  mattered most. `.ss-layout`'s column 1 (previously an empty spacer that
  existed only to keep `.ss-main` visually centered against the feed
  sidebar) now holds `.ss-result-wrap` instead, sticky-positioned to
  mirror `.ss-feed-col`'s own treatment. Below the 900px breakpoint, where
  the grid collapses to one column, `order` keeps the stacking sensible
  (search/hero, then result, then Recent Activity) independent of the
  source order needed for column-1 placement above the breakpoint.

**2026-09-19 — Scanner: real PNG/JPEG photo bug fixed, result photo moved to a full-viewport stage, logo moved to a background layer**
- **Root cause of the garbled/static-looking employee photo** reported on
  the standalone Scanner: `employees.photo_thumb_b64` is fetched
  server-side by `upload-employee-photo` from Drive's `/thumbnail?...`
  endpoint, which returns whichever format it decides to generate the
  preview in — PNG for roughly two-thirds of the roster when checked
  live via Supabase MCP, JPEG for the rest — with no Content-Type
  captured alongside the stored bytes. Every consumer (`offlineAvatarHTML`
  in `Utils/format.js`, the Scanner's hero-photo swap) hardcoded
  `data:image/jpeg;base64,...` regardless, so a PNG-formatted thumbnail
  decoded as visual noise instead of either the real photo or a clean
  broken-image icon. Fixed client-side only, no schema or Edge Function
  change: new `sniffImageMimeFromBase64()` / `photoDataUri()` in
  `Utils/image.js` read the real magic bytes (PNG/JPEG/GIF/WEBP
  signatures) off the first ~16 decoded bytes and build the `data:` URI
  from that instead of an assumed label. Both call sites switched over.
- **Result photo moved from `.ss-icon` to a dedicated full-viewport
  stage** (`.ss-photo-stage`, new fixed-position element sized via
  `min(82dvh, 82dvw)`): the previous approach swapped the photo directly
  into `.ss-icon`, which sits inside `.ss-main`'s grid column and capped
  the photo at `clamp(160px, 32dvh, 360px)` regardless of how much
  vertical space the kiosk display actually had. The new stage is sized
  purely off viewport height/width, independent of the 3-column layout,
  so it can't be constrained by (or overflow into) the feed sidebar.
- **Logo mark moved out of `.ss-icon` into a full-viewport background
  layer** (`.ss-bg-logo`, `position:fixed`, low-opacity, sized off
  `min(72dvh, 72dvw)`): previously the Proximity mark lived inside the
  small hero ring for the idle state; now it's ambient branding behind
  the whole kiosk screen (header + feed panel included), and `.ss-icon`
  is left empty as just the center point for the pulsing `.ss-ring`
  animation. `.ss-header` and `.ss-layout` got explicit
  `position:relative;z-index:1;` so they still stack above the fixed
  background/photo layers correctly.
- Test Scan's `.ts-icon`/`.ts-ring` were deliberately left untouched —
  same reasoning as every earlier entry that's scoped a Scanner change to
  the standalone kiosk only: Test Scan is an in-shell admin diagnostic
  panel, not a door-facing kiosk screen, so a full-viewport photo/logo
  layer doesn't fit its embedded layout. It still benefits from the
  `offlineAvatarHTML` mime fix above, since `ScanResultCard.js` is shared
  by both.

**2026-09-19 — Scanner: full-size result photo, and a real CSS regression fixed along the way**
- While investigating, found `.ss-icon`/`.ts-icon` in `CSS/scanner.css`
  entirely commented out — the hero logo mark had no sizing/background/
  border rules at all, left over from some earlier edit that never got
  restored. Uncommented both; unrelated to the feature below but a real,
  visible regression worth fixing on sight.
- Added a large centered result photo: on a matched scan with a photo on
  file, the standalone Scanner's hero icon swaps from the small logo mark
  to the employee's actual photo at `clamp(160px, 32dvh, 360px)` — same
  dvh-scaled idiom `.ss-icon`/`.ss-ring` already used, just bigger and
  circular, since the point is recognizing someone from a normal viewing
  distance rather than a badge-sized crop. Reuses `photo_thumb_b64`
  already on `data.employee` for every scan result (online or offline —
  see `ScanResultCard.js`), so no extra fetch. Reverts to the logo at the
  same moment the result card itself fades out, and explicitly resets on
  any non-photo result (unmatched, or matched with no photo on file) so a
  scan right after a matched one can't leave the previous person's photo
  showing. Test Scan's `.ts-icon` got the same CSS fix but not the photo
  swap itself — it stays a plain diagnostic tool, consistent with why it
  was left out of offline support too (see the 2026-09-16 entry below).

**2026-09-19 — Scanner responsiveness: three real fixes, one honest limit**
- **Online→offline scan slow to render**: `ScanEventsModel.scan()` had no
  timeout, and `doScan()` trusted `navigator.onLine` to decide whether to
  even attempt it. `navigator.onLine` only reflects whether the device has
  *an* active network interface, not whether the internet (or Supabase)
  is actually reachable — it commonly still reads `true` for a while
  after a connection has genuinely died. When that happened, the scan
  hung on the browser's native TCP/DNS timeout (tens of seconds) before
  ever falling back offline. Fixed: the online attempt now races against
  a 4s local timeout (`ONLINE_SCAN_TIMEOUT_MS`); a timeout is treated
  exactly like any other network failure and falls straight through to
  the same offline path.
- **Sync queue not "almost instant"**: `flushQueue()` processed every
  queued scan strictly one RPC round trip at a time, globally. Fixed:
  entries are now grouped by employee (`proximity_code`) and different
  employees' groups sync concurrently (bounded to 6 at once) — still
  strictly sequential *within* one employee's own entries (direction is
  derived server-side from that employee's scan_logs length at call
  time, so their own entries can never race each other), but unrelated
  employees no longer wait behind one another. Still stops all groups on
  the first failure, same safety reasoning as before, just scoped
  correctly now.
- **Queue rows "disappearing" from Recent Activity**: an online scan
  unconditionally called `loadScanFeed()`, which wholesale-replaces the
  feed with whatever's authoritative in `scan_events` right now. If that
  happened while there was STILL an un-synced backlog (common in the
  first moments after reconnecting), the reload wiped the visible
  "Queued — syncing…" rows for scans that hadn't actually synced yet —
  the data was always safe in IndexedDB, but the UI looked like it lost
  them. Fixed: `doScan()`'s online branch now checks the queue first and
  drains it (reusing the same flush function `initOfflineSupport` uses
  internally, now exposed for this) before reloading the feed, so nothing
  is ever wiped without being properly replaced by its real synced row.
- **Employee Manager upload still slow** (after the thumbnail-fetch
  timeout fix in the entry below): partially addressed, not eliminated.
  `upload-employee-photo` now caches its Google OAuth access token across
  warm Edge Function invocations instead of re-fetching one on every
  single call — a real network round trip removed from most uploads. What
  this does NOT remove: the upload itself is inherently 3 sequential
  Google Drive API calls (upload the file, make it public, fetch the
  thumbnail) plus, on a cold instance, the token exchange — that's
  real, unavoidable round-trip latency to an external service, not a
  bug. If this still needs to feel meaningfully faster, the honest next
  step is client-side: skip the wait entirely by saving the employee
  record optimistically and letting the Drive upload finish in the
  background, rather than trying to shave further milliseconds off a
  sequential external API chain.

**2026-09-19 — Three real regressions from the `photo_thumb_b64` change, plus one non-bug worth clarifying**
- **Upload noticeably slower** — real bug, now fixed. `upload-employee-photo`
  fetched the server-side thumbnail (see 2026-09-18 below) synchronously,
  in the upload's own critical path, with no timeout. A freshly-uploaded
  Drive file doesn't always have a thumbnail ready to serve instantly —
  generation can lag the upload by a second or more — and that lag sat
  directly in every single upload's response time, regardless of roster
  size. Fixed with a 2.5s `AbortSignal.timeout()` on that one fetch: a
  slow thumbnail now just comes back as `thumb_b64: null` (same
  best-effort fallback as any other thumbnail failure) instead of holding
  up the whole upload. Deployed as v33.
- **Sync queue slow on reconnect** — real bug, now fixed, and not what it
  looked like: `OfflineScanModel.flushQueue()`'s per-item progress
  callback was calling the FULL `renderOfflineStatus()` (2 IndexedDB
  reads + rebuilding the header pill) after every single synced scan —
  stacked directly on top of each scan's own sync RPC call. For a queue
  built up over a longer outage, that's dozens of redundant IndexedDB
  round trips with no benefit, visibly slowing the whole flush down.
  `StandaloneScanner.js` now updates the sync-status line with a cheap,
  synchronous text update from the numbers `flushQueue()` already hands
  it, and only runs the full `renderOfflineStatus()` once, after the loop
  finishes. Also added a 30-second floor between cache refreshes
  regardless of what triggered them — `online`, Alt-Tab
  (`visibilitychange`), and the 5-minute interval all funnel through the
  same refresh path, and a few quick Alt-Tabs in a row were each
  triggering a full roster re-fetch back to back for no reason.
- **Alt-Tab back into the Scanner showed "Loading…" on Recent Activity**
  — real bug, now fixed. The 2026-09-17 fix below only filtered
  `TOKEN_REFRESHED` auth events to stop them from triggering a full
  `boot()`/re-render on every focus regain. Supabase-js can *also* emit a
  same-user `SIGNED_IN` event on that same focus-regain session check,
  depending on which internal path its visibility-driven validation
  takes — left unguarded, that was the remaining route to the exact same
  full re-render (and the exact same "Loading…" flash) the earlier fix
  was meant to eliminate entirely. `main.js` now treats a `SIGNED_IN`
  event for the *same* user id the same way as `TOKEN_REFRESHED`: update
  the session reference, skip `boot()`. Only a genuinely new sign-in (no
  prior session, or a different user) still triggers a real re-render.
- **"Still not showing image for all new scans" — not a bug, a data
  fact**: only 7 of 705 employees have ever had a photo uploaded at all
  (verified directly against the `employees` table). The `photo_thumb_b64`
  pipeline is working correctly for all 7 who have one — this was
  confirmed by checking the data, not assumed. Scanning any of the other
  698 correctly shows initials, because there is no photo on file to
  show, online or offline. Worth testing specifically against one of the
  7 known-to-have-a-photo employees to confirm the pipeline itself before
  concluding it's broken again.
- **Noted for later, not acted on now** *(superseded — see the
  2026-09-19 "Split `get_scanner_offline_cache()`" entry below: this
  ended up getting acted on the same day, not deferred)*: `get_scanner_offline_cache()`
  currently embeds `photo_thumb_b64` in the same roster-wide payload
  that's refreshed every 5 minutes and after every reconnect. At 7
  photos / 0.07MB total this isn't a measurable cost today, but it's the
  wrong shape to keep scaling — a lookup that needs to stay small and
  frequent is coupled to a payload that will only grow and doesn't need
  refreshing nearly that often. If photo adoption grows substantially,
  worth splitting into a separate, infrequently-refreshed
  employee_id→thumbnail cache rather than letting this one keep growing
  in place — flagged here deliberately instead of rebuilding it
  preemptively a third time on a hunch.

**2026-09-19 — Split `get_scanner_offline_cache()`'s photo payload into its own RPC + cache**
- Follow-through on the "noted for later" bullet immediately above, from
  earlier the same day — reopened sooner than planned because a
  same-day Postgres migration (`split_offline_lookup_and_photos`) had
  already done the backend half before this repo's docs or client code
  caught up with it. **If you're another Claude session and you see a
  gap like this again: `Supabase:list_migrations` before trusting this
  file's account of "what's been decided vs. done" — a migration can
  land without a matching commit/doc update landing at the same time.**
- Backend (already live, this entry documents it rather than
  introducing it): `get_scanner_offline_cache()` no longer returns
  `photo_thumb_b64` at all. New RPC `get_scanner_offline_photos()`
  returns a sparse `[{employee_id, photo_thumb_b64}]` array — only
  employees who actually have a thumbnail, not the whole roster — with
  the same `is_admin() or can_view_scanner()` permission gate as every
  other scanner RPC. Grants were already correct (`anon` cannot execute,
  `authenticated` can) — verified via `has_function_privilege()`, not
  assumed.
- Client (this commit): `JS/Utils/idb.js` gained a third IndexedDB store,
  `photoCache` (`DB_VERSION` 1→2, purely additive — no migration of the
  existing two stores needed). `OfflineScanModel.js` gained
  `refreshPhotoCache()` (calls the new RPC, stores it as a plain
  `employee_id -> b64` map) and now merges that map into
  `getCacheMeta()`'s rows by `employee_id` before handing them to
  `classify()` — which means `classify()` itself needed **zero**
  changes: it still just reads `row.photo_thumb_b64` off whatever row
  it's given, with no idea the photo came from a separate cache/RPC now.
  `StandaloneScanner.js` refreshes the photo cache on its own 30-minute
  interval (vs. the lookup cache's 5 minutes) — gated by its own 5-minute
  minimum-gap floor, same pattern as the existing lookup-refresh
  throttle — since a photo only changes on re-upload, not worth polling
  anywhere near as often.
- Not changed: `classify()`, `ScanResultCard.js`, `ScanFeed.js`, and
  `TestScanPage.js` (still has no offline support, unaffected either
  way) — every consumer of `photo_thumb_b64` keeps reading it from
  exactly the same place on the employee/row object as before. The split
  is invisible above `OfflineScanModel.getCacheMeta()`.

**2026-09-18 — Offline scanner photos: replaced the entire Drive-prefetch approach with a stored base64 thumbnail**
- After the LAN-IP fix below made the Service Worker actually run, and
  `photo_file_id` cache-busting and the live-fetch retry were all in
  place and individually correct, photos were *still* inconsistently
  missing for some employees, sometimes, with no obvious pattern — the
  behavior reported that finally pinned down why the whole approach was
  fragile at its foundation, not just missing one more edge case.
- **Root cause:** the roster-wide photo prefetch (`OfflineScanModel.js`'s
  old `prefetchPhotos()`) fetched every employee's Drive thumbnail with
  `{ mode: 'no-cors' }`, since Drive's `/thumbnail` endpoint sends no CORS
  headers for a page-script `fetch()`. A `no-cors` response is always
  "opaque" — status 0, `ok: false` — **whether or not the request actually
  succeeded**. Across a 700+-person roster, that meant any transient
  failure (a rate limit, a timeout, a dropped connection) among hundreds
  of concurrent requests was completely indistinguishable from success
  and got cached by `sw.js` as if it had worked — there was no way for
  that architecture to ever be fully reliable, by design of what
  cross-origin `no-cors` responses can tell you.
- **Fix — sidestep the problem instead of chasing it further:** deleted
  `prefetchPhotos()`, `sw.js`'s `PHOTO_CACHE`, and `Utils/format.js`'s
  live-retry-fetch logic entirely. `upload-employee-photo` now fetches a
  small (`sz=w96`) Drive thumbnail **server-side**, right after upload —
  a normal same-origin-to-Google server fetch with a real, trustworthy
  HTTP status, no CORS or opaque-response ambiguity at all — and returns
  it as base64 (`thumb_b64`) alongside the usual `url`/`file_id`. The
  client stores it directly on the row (`employees.photo_thumb_b64`, a
  new column), and both `get_scanner_offline_cache()` and `get_scan_feed()`
  now return it. The Scanner's result card and Recent Activity feed
  render it via a new `offlineAvatarHTML()` (`Utils/format.js`) — a plain
  `data:image/jpeg;base64,...` `<img src>`, no network request at all,
  identical online or offline. There is nothing left to prefetch, cache,
  or race against a network outage: the thumbnail already rides along in
  every scan response, the moment the photo is uploaded.
- Employee Manager and Directory are untouched — they still use the
  original `avatarHTML()` and the full-resolution Drive URL, since they're
  always used online and a 96px thumbnail would be a downgrade there for
  no benefit.
- Full detail (schema, RPC, and Edge Function changes) in
  `Supabase/README.md`'s matching entry.

**2026-09-18 — Recent Activity: a failed feed refresh dumped a raw JS error into the UI**
- `ScanFeed.js`'s `loadScanFeed()` is called unconditionally on page init
  (`StandaloneScanner.js`), including on a page load that happens while
  already offline. When the underlying `get_scan_feed()` RPC call fails
  (no network — the exact condition being tested throughout this whole
  offline-photo saga), the old code did
  `feedEl.innerHTML = error.message` — showing the operator the literal
  JS exception text (`TypeError: Failed to fetch`) as if it were a feed
  row, and wiping out any existing content in the process, including
  pending offline-scan rows that were already visible.
- Fixed: a failed refresh with nothing already in the feed shows a plain
  "Recent activity unavailable — offline/reconnecting…" placeholder
  instead of the raw error; a failed refresh with existing rows leaves
  them alone entirely rather than clobbering them. This matches the
  "best-effort, never let a network hiccup break the rest of the app"
  pattern the rest of the offline path already follows.

**2026-09-18 — Offline scanner: the actual root cause of the whole photo saga — testing over a LAN IP**
- Every fix below this one (prefetch coverage, `photo_file_id` cache-busting,
  the live-fetch retry) was real and necessary, but none of them could
  ever have worked during testing, because the Service Worker itself was
  never running: Service Workers require a secure context (HTTPS, or
  `http://localhost`/`http://127.0.0.1`), and testing happened over a
  bare LAN IP (`http://10.x.x.x:5500`, the kind of URL Five Server shows
  you right alongside `localhost`) — which browsers do NOT treat as
  secure, even on a trusted local network. `navigator.serviceWorker.
  register()` was rejecting on every single page load, silently: the
  `.catch(() => {})` in `JS/main.js` swallowed the failure with zero
  console output, so "no photos ever cache, online or offline, for
  anyone" looked exactly like an application bug from the console, not
  like a wrong-URL problem. Confirmed via DevTools: Cache Storage
  (`proximity-photos-v1`) was completely empty while IndexedDB (the
  roster lookup, which doesn't need a Service Worker) had real data —
  the SW-dependent half of offline support was simply never active.
- Fixed by logging the actual rejection reason (`JS/main.js`) instead of
  discarding it, with an explicit message pointing at the localhost/
  127.0.0.1 requirement. No other code changed — the underlying fixes
  were already correct once tested against `http://localhost:5500`
  instead of the LAN IP.
- Worth remembering for eventual real kiosk deployment, not just local
  dev: a kiosk hitting this app over a bare LAN IP without HTTPS will
  hit this exact same silent failure in production. Production needs
  either real HTTPS (a proper cert, or a reverse proxy that terminates
  TLS) or, if that's genuinely not available on the deployment network,
  Chrome's `unsafely-treat-insecure-origin-as-secure` flag set per-kiosk
  — not something to rely on by default, but worth knowing exists.

**2026-09-17 — Employee Manager: scan-log direction corruption, root-caused and fixed (Postgres-side)**
- Root cause and fix are entirely in `trg_append_scan_log()`/
  `scan_proximity_code()` — see `Supabase/README.md`'s matching change log
  entry for the full explanation (a genuine read-then-write race
  condition, not an offline-specific bug, just one offline sync made far
  more likely to hit). No JS changes for this part.
- `JS/Components/ScanLogModal.js` — display now preserves true insertion
  order (`.reverse()`) instead of re-sorting by `scanned_at`, since
  direction alternates correctly by insertion order but insertion order
  and `scanned_at` order can legitimately differ once an offline-captured
  scan syncs late with a backdated timestamp; re-sorting by time would
  visually "un-alternate" an otherwise-correct sequence. Entries captured
  offline now show an `OFFLINE` tag (hover for why the timestamp might
  look out of order) sourced from the new `scan_logs[].offline` field.

**2026-09-17 — Offline scanner: one more photo gap — `classify()` never attempts a live fetch**
- The prefetch work below (bundled default-avatar, `PHOTO_CACHE`, etc.)
  all assumed the photo either got prefetched in advance or didn't — but
  `OfflineScanModel.classify()` is purely local and never itself tries a
  network request. In the common case where "offline" actually means
  *Supabase specifically* failed while the general connection (and
  therefore Drive) is still fine, that meant a not-yet-prefetched photo
  fell straight to the default avatar even though it was, in that moment,
  perfectly reachable.
- `StandaloneScanner.js`'s `doScan()` now fires a best-effort, non-awaited
  `fetch(..., {mode:'no-cors'})` for the scanned employee's photo the
  moment it takes the offline path — if Drive really is reachable this
  lands in `sw.js`'s `PHOTO_CACHE` within roughly a second. `Utils/format.js`'s
  `avatarHTML()` now retries its own `<img>` once after a short delay
  before giving up to the default avatar, specifically to give that
  fetch a chance to land in time for the same result card. Harmless if
  genuinely fully offline — both just fail the same way and change
  nothing.
- **Still an open question worth confirming, not assumed:** if scans in
  your testing are failing while the header still shows "● Online," that
  strongly suggests a Supabase-specific outage rather than true
  network-level offline — the fix above targets exactly that case. If
  you're testing via a full network cut (DevTools "Offline," airplane
  mode), the only real fix for a not-yet-prefetched employee is giving
  the roster-wide prefetch (see below) time to finish before going
  offline — that's a timing/patience issue, not a bug.

**2026-09-17 — Offline scanner: bundled default-avatar image for missing/uncached employee photos**
- `avatarHTML()` (`Utils/format.js`) only ever had two tiers: the real
  Drive photo, or initials. Offline, that meant anyone whose photo hadn't
  been successfully prefetched before the connection dropped (or who
  simply has no photo on file) fell straight to a bare initials circle —
  fine online, but a flat/uninformative result on a kiosk screen offline.
- Added a third tier, used only when there IS a `photo_url` but it can't
  be reached: `Public/Assets/EmployeePhoto/default-avatar.svg`, a single
  bundled generic silhouette, **precached by `sw.js` at install time**
  (same as the 5 bundled scan sounds below) so it's available from a
  device's literal first load, online or not. Unlike individual employee
  photos (700+, can't be precached as a fixed set), this is one static
  asset that never changes, so precaching it outright is straightforward.
- `avatarHTML()` now tries the real photo (when there's a `photo_url`) →
  falls back to this bundled image on load failure → falls back to
  initials only if even that local asset somehow fails to load. An
  employee with no `photo_url` at all still goes straight to initials, as
  before — the bundled silhouette is specifically for "this person does
  have a photo, we just can't reach it right now," not a stand-in for "no
  photo on file." Updated `sw.js`'s and `OfflineScanModel.js`'s comments
  that described the old two-tier behavior to match.
- Colors are hardcoded directly in the SVG rather than `currentColor` +
  CSS vars, same reasoning as `ProximityLogo.js`'s comment on the brand
  mark: this is loaded via a plain `<img src>`, an isolated document that
  can't inherit the host page's styles — only an inlined SVG (like the
  logo) can be recolored by the page around it.

**2026-09-17 — Offline scanner: the 5 bundled fallback sounds actually exist now**
- The entry two below this one ("true cold-start sound support") added
  `sw.js`'s precache list and `scanSounds.js`'s `FALLBACK_SOUND_PATHS`
  pointing at 5 files under `Public/Assets/Sounds/` — but the files
  themselves, and the `gen_sounds.py` script that was supposed to produce
  them, were never actually committed. Every genuinely-offline-from-first-
  load kiosk was silently falling through to nothing: `sw.js`'s
  `cache.addAll(FALLBACK_SOUND_URLS)` at install time was failing (caught
  and swallowed by its own `.catch(() => {})`, by design, so it never
  surfaced as an error) since there was nothing at those paths to fetch.
- Added `gen_sounds.py` (repo root, stdlib-only — `wave` + `math` +
  `struct`, no numpy/deps) and ran it to produce the 5 real `.wav` files
  now sitting in `Public/Assets/Sounds/`: short synthesized tones, not
  polished audio, distinct per outcome (ascending two-note chime for
  `matched-in`, its descending mirror for `matched-out`, a harsh low buzz
  for `card-revoked`, a two-beep for `unmatched`, a single mid tone for
  `unassigned-card`).
- Fixed two other doc spots this uncovered while re-reading against the
  live repo: the Project-structure tree's `ScanSoundsModel.js` line still
  said "4 fixed... keys" (there are 5), and `Public/Assets/`'s own tree
  entry never listed `Sounds/` at all.

**2026-09-17 — Offline scanner: the photo cache was never actually caching anything, plus true cold-start sound support**
- **`PHOTO_CACHE` (added in the first "root-cause fixes" pass below) could
  never actually cache a single photo.** `cacheFirstWithRefresh()` only
  called `cache.put()` when `res.ok` was true — but a cross-origin
  `no-cors` request (which is what the browser sends by default for a
  third-party `<img src>` like Drive's thumbnail endpoint) always comes
  back as an **opaque** response: `status: 0`, `ok: false`, unconditionally,
  by design, regardless of whether it actually succeeded — the browser
  deliberately hides the real result so a page can't probe a cross-origin
  resource's status. So the `res.ok` check was quietly false on every
  single photo response, forever, no matter how many times a photo loaded
  successfully online. Fixed in `sw.js`: also cache `res.type === 'opaque'`
  responses — there's nothing else available to check them against, which
  is the accepted tradeoff for caching third-party resources at all.
- **Most of the roster's photos were never cached even once**, since the
  only path that populated `PHOTO_CACHE` was an `<img>` tag actually
  loading — i.e. someone had to scan (or otherwise view) that specific
  employee while online first. For a 700+-person roster, that's most of
  it, every time. Added `OfflineScanModel.refreshCache()` →
  `prefetchPhotos()`: after refreshing the offline lookup, proactively
  `fetch(url, { mode: 'no-cors' })`s every roster photo (bounded to 6
  concurrent, once per page session) purely to make the Service Worker's
  `fetch` listener see and cache each one, without ever reading the
  (unreadable, opaque) response itself.
- **Scan sounds still went silent on a device's very first-ever offline
  load** — the existing `SOUND_CACHE` is cache-first-with-refresh, which
  is correct for "works offline after having been online once" but can't
  help a kiosk that's never been online with this app at all. Added 5
  small bundled default tones under `Public/Assets/Sounds/`
  (`gen_sounds.py`-style short synthesized beeps, not the admin's actual
  uploaded clips), **precached in `sw.js`'s `install` handler** — not
  lazily on first fetch like everything else — so they're available
  starting from the literal first page load, online or not.
  `Utils/scanSounds.js`'s `playScanSound()` now tries the admin's custom
  clip first and falls back to the matching bundled tone when it's
  missing or fails to load.
- **Fixed a real drift bug while adding the above**: `EmployeeModal.js`'s
  and `DirectoryPage.js`'s avatar `<img>` tags build `photo_url` directly,
  without `avatarHTML()`/the cache-busting `cb=` param — so those two
  spots (Employee Manager grid, Edit modal) can show a stale browser-cached
  photo after a swap, unlike everywhere the Scanner touches, which all go
  through `avatarHTML()`. Not fixed here (out of scope for an offline-
  scanner pass, and those two spots are online-only screens with no
  offline angle) — flagging since it's the same *class* of bug as the
  `/thumbnail`-vs-`uc?export=view` mismatch two entries below.
- Also: `ScanSoundsModel.js`'s and this README's own doc comments said "4"
  scan sounds in three places — there are, and always were in the current
  schema, 5 (`unassigned_card` was already a real key). Fixed the ones
  describing current behavior; left the historical changelog entries below
  as-is, since a changelog describes state-at-the-time, not now.
- Extracted `Utils/format.js`'s URL-building logic out of `avatarHTML()`
  into a standalone `photoSrc()`, so `prefetchPhotos()` above can build the
  *exact* same cache-busted URL `avatarHTML()` will request later — one
  function, two callers, instead of two copies that could drift apart
  (which is exactly how the `/thumbnail` mismatch below happened).

**2026-09-17 — Offline scanner: root-cause fixes for bugs that survived the first pass**
- **Scan sounds still never played, even once sounds were loading
  correctly.** The earlier fix that day addressed `loadScanSounds()`
  failing to fetch the sound URLs at all — but `playScanSound()` itself
  was still being silently rejected by the browser's autoplay policy
  every single time, not intermittently. It's always called from inside
  `doScan()` *after* an `await` (the scan RPC, or the offline lookup) —
  and a browser's transient user-activation window from the keydown/Enter
  that started the whole thing expires across that `await`, so `.play()`
  never actually had a valid gesture behind it by the time it ran. Fixed
  with `initAudioUnlock()` in `Utils/scanSounds.js`: plays a near-silent
  clip synchronously inside the very first real keydown/pointerdown on
  the page (no `await` in between), which is enough for browsers to allow
  further programmatic `audio.play()` calls for the rest of that page's
  session. Wired into both `StandaloneScanner.js` and `TestScanPage.js`.
- **Offline scans still showed initials instead of the photo**, even
  though `classify()` already passes `photo_url` through correctly. The
  gap wasn't the data — a genuinely offline browser simply has no network
  path to Google Drive at all, and `sw.js` never cached Drive's thumbnail
  responses (only the app shell and the scan-sounds bucket were). Added a
  third `PHOTO_CACHE` to `sw.js`, cache-first with background refresh,
  intercepting `drive.google.com/thumbnail?...` requests the same way the
  existing sound cache handles the scan-sounds bucket. An employee's
  photo is now available offline once it's loaded successfully at least
  once while online. See `Supabase/README.md`'s "Offline scanning".
- **Offline scans still didn't appear in Recent Activity at all until
  sync** — by design at the time, since nothing's written to
  `scan_events` yet for a queued-but-unsynced scan, so a real feed reload
  has nothing new to show. The actual product ask was to see them
  immediately, not just after sync. `ScanFeed.js` now exports
  `prependPendingRow()`: a local, non-authoritative "Queued —
  syncing…" row (dashed left border, dimmed), built straight from the
  offline `classify()` result. It's plain DOM, never persisted anywhere,
  and gets wholesale replaced by the real synced entry the next time
  `loadScanFeed()` runs.

**2026-09-17 — Offline scanner: reconnect/feed/sound/photo bug fixes**
- **Resync on reconnect wasn't reliable.** The queue only ever flushed on
  the browser's `online` event, and the periodic timer only refreshed the
  lookup cache, not the queue — so a missed/never-fired `online` event
  (common on flaky Wi-Fi, captive portals, some mobile browsers, or a
  kiosk tab that was simply backgrounded when connectivity came back)
  could leave scans stranded until a manual reload. Fixed with a cheap
  20s poller (a no-op IndexedDB read when nothing's queued) plus a
  `visibilitychange` listener, both independent of the `online` event.
- **Recent Activity didn't show synced offline scans.** The reconnect
  handler refreshed the offline lookup cache but never reloaded the feed,
  so scans that had just been written to `scan_events` for the first time
  stayed invisible until something else happened to trigger a reload.
  Now reloads the feed whenever a flush actually syncs anything.
- **Scan sounds could go silent for a whole session.** `loadScanSounds()`
  ran once on mount and silently swallowed a failure with no retry — a
  kiosk that first loaded offline (or raced a flaky connection on that
  first call) got no scan-feedback audio for the rest of the session.
  Now retried on the existing 5-min cache-refresh cycle until it actually
  succeeds.
- **Offline scans showed initials instead of the employee photo.**
  `get_scanner_offline_cache()` already returns `photo_url`/`updated_at`
  (see `Supabase/README.md`) — `OfflineScanModel.classify()` just wasn't
  passing them through to the rendered result. Fixed client-side only, no
  RPC change needed.
- Moved the "Syncing N offline scans…" / "N scans queued" line out of the
  header pill and under Recent Activity (bottom-right of the kiosk layout,
  new `.ss-sync-status` element) — it's feed-scoped info, not kiosk-health
  info, so it now sits next to the feed it actually affects. The header
  pill still shows online/offline + lookup-cache staleness.

**2026-09-16 — Offline-capable Scanner (app shell + scan queue, ~24h target)**
- New `sw.js` at the **repo root** (deliberately not inside `Public/` — see
  its own file-tree entry above for why) — a Service Worker that caches
  the app shell (HTML/CSS/JS/vendor) network-first-falling-back-to-cache,
  and the `scan-sounds` bucket's audio files cache-first-with-refresh.
  Registered from `JS/main.js` via an absolute `/sw.js` path. Deliberately
  does not intercept any other Supabase request (REST/Auth/RPC) — those
  must always hit the real network or fail visibly.
- New `JS/Utils/idb.js` (minimal hand-rolled IndexedDB wrapper — no new
  dependency) and `JS/Models/OfflineScanModel.js`: a local lookup-cache
  copy (via the new `get_scanner_offline_cache()` RPC — see
  `Supabase/README.md`) for classifying a scan without network, and a
  queue of raw scan attempts made offline, replayed strictly in order
  once back online through the real `scan_proximity_code()` RPC (now
  accepting an optional backdated `p_scanned_at` so a scan synced hours
  later still logs its true original time).
- `JS/Features/Scanner/StandaloneScanner.js` — new header status pill
  (online/offline, pending queued-scan count, lookup-cache staleness
  warning past 24h), offline branch in `doScan`, periodic 5-min cache
  refresh while online, and sync-on-reconnect. **`Test Scan` was
  deliberately left untouched** — it's an admin diagnostic tool, assumed
  to be used at a desk with a real connection; only the kiosk-facing
  Scanner needed this.
- **Judgment call worth knowing about, not buried in code comments:** past
  24h without a refresh, the lookup cache is shown as stale but scanning
  still works (fail-open) — a card revoked since the last refresh could
  still scan as valid until the kiosk reconnects. Flip this to fail-closed
  in `OfflineScanModel.js` if this scanner is ever the *sole* access
  control for something higher-stakes than an attendance log.
- **Known gap, not solved here:** the kiosk's Supabase session token still
  needs network to refresh (default ~1hr expiry) — see "Suggested next
  steps" above.
- Also fixed in passing: an earlier `CREATE OR REPLACE` on
  `scan_proximity_code()` this same session added new parameters, which
  Postgres treats as a distinct overload rather than a replacement when
  the argument *types* change — this briefly left the original 2-arg
  version orphaned and, because a newly `CREATE`d function grants
  `EXECUTE` to `PUBLIC` by default in this project, made the new 4-arg
  version callable by `anon` (unauthenticated). Caught immediately via
  `get_advisors`, dropped the orphaned overload, and revoked
  `public`/`anon` execute on both new functions — confirmed clean via
  `has_function_privilege()` before shipping. Noted here since it's the
  kind of mistake worth being able to spot again if it recurs.

**2026-09-15 — Proximity Cards: click-to-copy proximity code**
- Proximity Cards' "Proximity code" column now uses the same click-to-copy
  affordance as Employee Manager's Proximity ID column (dotted underline,
  toast on copy) instead of being plain unstyled `mono` text.
- Extracted the copy-to-clipboard logic — previously written once, inline,
  inside `DirectoryPage.js` — into `JS/Utils/clipboard.js`
  (`wireCopyableCodes(wrap, successLabel)`), and switched `DirectoryPage.js`
  to call it too, so there's exactly one implementation instead of two
  near-identical ones. Both pages' markup still uses the existing
  `.copyable-code` / `data-copy-code` convention from `CSS/base.css`, so no
  CSS changes were needed.
- Any future column that should be click-to-copy: give it
  `<span class="copyable-code" data-copy-code="${esc(value)}" title="Click to copy">${esc(value)}</span>`
  and call `wireCopyableCodes(wrap, 'your label')` once after painting that
  table — don't re-implement the clipboard try/catch a third time.

**2026-09-15 — Settings: employee-photo Google Drive storage capacity**
- New "Employee photos" section on the Settings page
  (`JS/Features/Settings/SettingsPage.js`), same visual pattern as the
  existing "Scan sounds" capacity bar below: `X of Y used — Z remaining`,
  a `.progress` bar that switches to warn color at ≥80% full, and a
  manual Refresh button (this number can change from outside this app,
  so it's not just repainted from local state like the sound rows are).
- **Important scope caveat, surfaced directly in the UI copy**: employee
  photos live in a Google Drive folder (see `upload-employee-photo`
  below), but Drive's API has no per-folder quota — `storageQuota` is
  reported for the *entire* connected Google account, Gmail and Google
  Photos included. The number shown is "how full is the whole connected
  Google account", not "how much room is left for employee photos"
  specifically. Don't remove that caveat text when touching this section.
- New `EmployeesModel.getPhotoStorageQuota()` in
  `JS/Models/EmployeesModel.js` — calls the Edge Function with
  `{ action: "quota" }`, same `readFunctionError()` unwrapping as
  `deletePhoto()`.
- **Backend note for future sessions**: the `upload-employee-photo` Edge
  Function's `action: "quota"` handler (`getDriveStorageQuota()`, reading
  Drive's `about.get?fields=storageQuota`) was already live on the
  Supabase project (`kjwttqmbcjvkivgmwuev`, function version 26) *before*
  this commit — it wasn't in this repo's `Supabase/functions/
  upload-employee-photo/index.ts` yet, so the deployed backend and the
  repo had drifted. This change reconciles the repo file to match what's
  actually deployed rather than deploying a second, slightly-different
  implementation over it. **If you're another Claude session touching
  this function: `Supabase:get_edge_function` before editing it** — the
  live version can be ahead of this repo, since edits are sometimes made
  directly against the Supabase project (via MCP tools) without a
  matching GitHub commit landing at the same time.

**2026-09-15 — Settings page + admin-uploaded scan sounds**
- New Supabase Storage bucket `scan-sounds` (public, admin-only write via
  RLS) — 4 fixed, extension-less object keys (`matched-in`, `matched-out`,
  `card-revoked`, `unmatched`), so replacing a sound is a plain upsert
  onto the same path rather than needing old-file cleanup across format
  changes. See `Supabase/README.md`.
- `public.test_scan_proximity_code()` now also returns `direction` on a
  matched result (same read-only parity preview `scan_proximity_code()`
  already computed from `scan_logs` length — nothing is written). Before
  this, Test Scan could never show the IN/OUT badge or play the right
  sound, only the real logging scanner could.
- New `JS/Models/ScanSoundsModel.js` — list/upload/remove against the
  bucket, plus `publicUrl(key)`.
- New `JS/Utils/scanSounds.js` — `loadScanSounds()` (call once per screen
  mount, not per-scan) and `playScanSound(data)`, which maps a scan result
  to one of the 4 keys (`inactive_employee` / `unassigned_card` have no
  dedicated sound and stay silent, rather than guessing with an unrelated
  clip).
- New `JS/Features/Settings/SettingsPage.js` — admin-only; upload/replace/
  remove/preview for all 4 sounds, mirroring `UsersPage.js`'s admin-gate
  pattern. Its own top-level route/file (not folded into Users & Roles) so
  future non-user settings have a home without another restructure.
- `JS/Core/router.js` / `state.js` / `screens.js` and `Public/index.html`
  — new `settings` route, gated to `isAdmin()` the same way `nav-users` is,
  including the same-route landing-page fallback chain in `showShell()`.
- `JS/Features/Scanner/StandaloneScanner.js` and `TestScanPage.js` — call
  `loadScanSounds()` on mount and `playScanSound(data)` right after a
  result renders. `audio.play()` rejections (autoplay policy, unsupported
  format) are swallowed — a missed notification sound must never block or
  error out the actual scan result on screen.

**2026-09-14 — Scanner/Test Scan hero: brand mark + copy + dvh sizing**
- `JS/Components/ScanFeed.js` — no change; noted only as a landmark, the
  actual edits were in the Scanner feature files below.
- `JS/Features/Scanner/StandaloneScanner.js` and
  `JS/Features/Scanner/TestScanPage.js` — the hero's center icon (previously
  a plain `▣` glyph) now renders the Proximity logo mark via
  `PROXIMITY_LOGO_SVG` from the new `JS/Components/ProximityLogo.js`. The
  label under it changed from two-line `TAP` / `YOUR CARD` (uppercase, split
  span) to a single line, sentence-case **"Tap your card"**.
- New file `JS/Components/ProximityLogo.js` — inlines the same artwork as
  `Public/Assets/Logo/proximity-logo.svg` as a template string, deliberately
  **not** loaded via `<img src>`: an `<img>`-referenced SVG is an opaque
  external document, so its `fill="currentColor"` paths would never pick up
  the host page's color and the mark couldn't be themed. If the source
  `.svg` file's artwork ever changes, `ProximityLogo.js` must be regenerated
  from it to stay in sync (don't hand-edit the path data in both places).
- `CSS/scanner.css` — `.ss-ring`/`.ss-icon` and `.ts-ring`/`.ts-icon` changed
  from fixed px to `clamp(minPx, Xdvh, maxPx)` so the hero scales with
  viewport height instead of staying a fixed size regardless of the kiosk
  display's dimensions. Added `.proximity-logo-mark{width:100%;height:100%}`
  to make the inlined mark fill whichever icon box it's placed in. Removed
  the now-dead `.ss-label .dim` / `.ts-label .dim` rules left over from the
  old two-span label markup.
- Not changed: `Public/Assets/Logo/proximity-logo.svg` itself (still the
  source of truth for the artwork) and `Public/index.html` (the file was
  already an unreferenced/orphan asset before this change — nothing linked
  to it via `<img>` or CSS `background-image`, despite the `class=
  "background-image"` baked into the raw SVG's root element, which is a
  leftover from wherever the asset originated and is unrelated to any CSS
  class actually defined in this repo).
