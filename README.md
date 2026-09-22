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
    ProfilesModel.js              callAdminUsers() invokes the admin-users Edge Function
    ScanEventsModel.js            scan() calls scan_proximity_code() RPC;
                                   recentFeed() reads get_scan_feed()
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
  Components/                 reusable UI pieces used by more than one feature
    Modal.js                     shared openModal/closeModal scaffold — every
                                  dialog below is built on this
    EmployeeModal.js
    ProximityCardModal.js
    UserModal.js
    ResetPasswordModal.js
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
                                       search/filter view via Utils/xlsxExport.js)
    Proximity/ProximityPage.js       (Proximity Cards; toolbar Export .xlsx
                                       button, added 2026-09-19, same pattern
                                       as Employee Manager's)
    Scanner/TestScanPage.js          (in-shell "Test Scan" — calls the
                                       non-logging test_scan_proximity_code() RPC,
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
    Users/UsersPage.js               (Users & Roles, admin-only; delete wired
                                       through admin-users v3+ w/ self-delete guard)
    Users/userOptions.js             (shared role/access-scope option lists)
    Settings/SettingsPage.js         (Settings — upload/replace/remove/
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
                                       see Supabase/README.md's change log)
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
    clipboard.js                  wireCopyableCodes(wrap, label) — click-to-copy
                                   for [data-copy-code] elements (.copyable-code
                                   in CSS/base.css); shared by Employee Manager's
                                   Proximity ID column and Proximity Cards'
                                   Proximity code column
    csv.js                       parseCSV / toCSV, used by ImportModal.js
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
  still returns `photo_thumb_b64` directly (Recent Activity re-fetches
  the whole feed often enough that a per-row column costs nothing extra),
  while `get_scanner_offline_photos()` — split out from
  `get_scanner_offline_cache()`, see that change log entry — returns it
  separately as a sparse `[{employee_id, photo_thumb_b64}]` array for the
  Scanner's own card/employee lookup cache, refreshed only every 30
  minutes (`OfflineScanModel.js`) instead of riding along in that lookup's
  much more frequent 5-minute refresh. The Scanner's result card and Recent
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
- Replace the placeholder SVGs in `Public/Assets/Favicon` and
  `Public/Assets/Icon` with real brand assets.
- The kiosk's Supabase session token still needs network to silently
  refresh (default ~1hr expiry) — offline scanning and app-shell loading
  now survive a real outage (see `Supabase/README.md`'s "Offline
  scanning"), but a kiosk offline *longer* than its token's lifetime could
  still get signed out. Consider a longer JWT expiry for scanner-only
  accounts specifically (Supabase Auth settings) if outages routinely run
  longer than an hour.

---
*Last reconciled against the live GitHub repo and live Supabase project on
2026-09-21. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*

### Change log (most recent first)

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
