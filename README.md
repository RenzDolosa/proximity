# Proximity — ID & Access System

A permission-based employee ID / proximity access system, built on Supabase
(Postgres + Auth + Edge Functions).

Live Supabase project: **`proximity`** (`kjwttqmbcjvkivgmwuev`)
Project URL: `https://kjwttqmbcjvkivgmwuev.supabase.co`

## 1. Project structure

```
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
  auth.css                    sign in / create account screen
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
  Components/                 reusable UI pieces used by more than one feature
    Modal.js                     shared openModal/closeModal scaffold — every
                                  dialog below is built on this
    EmployeeModal.js
    ProximityCardModal.js
    UserModal.js
    ResetPasswordModal.js
    ScanLogModal.js
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
    Auth/AuthScreen.js
    Directory/DirectoryPage.js       (Employee Manager — avatarHTML() helper,
                                       cache-busted via updated_at; the Edit/Add
                                       modal's photo picker shows a real upload
                                       progress bar, incl. an indeterminate
                                       shimmer while the function talks to Drive)
    Proximity/ProximityPage.js       (Proximity Cards)
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
    Settings/SettingsPage.js         (Settings, admin-only — upload/replace/remove/
                                       preview the 5 scan sounds, plus a read-only
                                       Google Drive storage-capacity panel for
                                       employee photos (whole-account quota, not
                                       folder-scoped — see change log); own
                                       top-level route so future non-user settings
                                       have a home)
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
                                   IndexedDB (2 object stores: offline lookup
                                   cache, offline scan queue) — the only thing
                                   backing OfflineScanModel.js; no external idb
                                   library, to keep this repo dependency-free

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

`index.html` references `../CSS` and `../JS` — it expects to be served
from *inside* the repo root, not as the root itself. `npx serve Public`
alone won't resolve those (or `/sw.js` below). Serve the repo root instead
and open the nested path:

```
npx serve .
```

Then open `http://localhost:3000/Public/index.html` (or whatever port it
prints) — this matches how Five Server serves it in local dev (see
`http://127.0.0.1:5500/Public/index.html`).

Sign up — your first account becomes admin. Add
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
  cache at all, unlike sounds above — a small (`sz=w96`) base64 JPEG
  thumbnail, fetched **server-side** by `upload-employee-photo` right
  after every upload (a normal same-origin-to-Google fetch, with a real
  HTTP status — no CORS or opaque-response ambiguity), and stored
  directly on the employee row. `get_scanner_offline_cache()` and
  `get_scan_feed()` both return it, so it rides along in every offline
  lookup row and every feed entry with zero extra requests. The Scanner's
  result card and Recent Activity render it via `Utils/format.js`'s
  `offlineAvatarHTML()` — a plain `data:image/jpeg;base64,...` `<img
  src>`, identical online or offline, nothing to prefetch, cache, or race
  against a network outage. This replaced an entire earlier generation of
  Drive-prefetch machinery (a `PHOTO_CACHE` Service Worker cache, a
  roster-wide background fetcher, cross-origin opaque-response handling)
  that turned out to be fundamentally unreliable at scale — see the
  2026-09-18 change log entry for the full root-cause story. Employee
  Manager and Directory are unaffected: they still use the original
  `avatarHTML()` and the full-resolution Drive `photo_url`, since they're
  always used online and a 96px thumbnail would be a downgrade there.
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
2026-09-19. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*

### Change log (most recent first)

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
- **Noted for later, not acted on now**: `get_scanner_offline_cache()`
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