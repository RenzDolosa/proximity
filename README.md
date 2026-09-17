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
                                   (list/upload/remove) behind 4 fixed, extension-
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
- **Employee photos** (`PHOTO_CACHE`): also cache-first-with-refresh, but
  fundamentally can't be precached like sounds — there are 700+ of them
  and growing, not a fixed set of 5. Instead,
  `OfflineScanModel.refreshCache()` proactively prefetches every roster
  photo (bounded to 6 concurrent requests, once per page session) right
  after it pulls the card/employee lookup, rather than only ever caching
  a photo the moment someone happens to scan that person while online —
  which in practice meant most of the roster's photos were never cached
  at all. A `photo_url` (`drive.google.com/thumbnail?...`) is a
  cross-origin request the browser can only make as `no-cors`, which
  comes back as an **opaque** response — `status: 0`, `ok: false`,
  always, by design, regardless of whether it actually succeeded. `sw.js`
  originally only cached `res.ok` responses, which silently meant it
  could never actually cache a single Drive photo despite every other
  piece of the pipeline looking correct; it now caches opaque responses
  too, since there's nothing else available to check them against.
  `JS/Utils/format.js`'s `photoSrc()` builds the exact same cache-busted
  URL both `avatarHTML()` (for display) and the prefetcher use, so the
  prefetch actually warms the cache key the later `<img>` will request —
  building that URL in two places that could drift apart is exactly how
  the `/thumbnail` vs `uc?export=view` format mismatch happened before
  (see the change log).
- **Queued scans** (`OfflineScanModel.js` + IndexedDB): covered separately
  below.

**Testing offline mode:** open the Scanner tab (`?scanner=1`) at least
once online first — it needs one successful load to cache the app shell
(via `/sw.js`) and the card/employee lookup (via
`get_scanner_offline_cache()`) before there's anything to fall back to
for the *lookup* itself. Scan sounds work from the very first load
regardless (bundled + precached, see above); photos improve the more the
kiosk has been online, since the prefetch above needs at least one
successful `refreshCache()` to have run. Then in Chrome DevTools →
Network → Throttling → **Offline** (killing the Wi-Fi/network adapter
itself also works, but doesn't let you flip back online from the same
panel to watch the queue sync). Scan a known code — the header pill
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
2026-09-17. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*

### Change log (most recent first)

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