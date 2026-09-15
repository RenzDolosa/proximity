# Proximity — ID & Access System

A permission-based employee ID / proximity access system, built on Supabase
(Postgres + Auth + Edge Functions).

Live Supabase project: **`proximity`** (`kjwttqmbcjvkivgmwuev`)
Project URL: `https://kjwttqmbcjvkivgmwuev.supabase.co`

## 1. Project structure

```
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
                               and restores route from the URL hash on reload
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
                                       scan-sound playback as Test Scan)
    Users/UsersPage.js               (Users & Roles, admin-only; delete wired
                                       through admin-users v3+ w/ self-delete guard)
    Users/userOptions.js             (shared role/access-scope option lists)
    Settings/SettingsPage.js         (Settings, admin-only — upload/replace/remove/
                                       preview the 4 scan sounds, plus a read-only
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
HTTP (see below) rather than double-clicking `index.html`.

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
           └── Storage (scan-sounds bucket) ── 4 fixed keys, public read,
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

```
npx serve Public
```

Then open the printed URL. Sign up — your first account becomes admin. Add
employees in **Employee Manager**, issue them a code in **Proximity
Cards**, then scan that code in **Test Scan** (in-app) or the standalone
**Scanner** tab (`?scanner=1`, logs to `scan_events`).

As an admin, visit **Settings** to upload a short audio clip for each of
the 4 scan outcomes (Matched/Success IN, Matched/Success OUT, Card
revoked, Unknown proximity ID) — Test Scan and the live Scanner both play
them automatically as soon as a result comes back. An outcome with
nothing uploaded just stays silent.

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

---
*Last reconciled against the live GitHub repo and live Supabase project on
2026-09-15. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*

### Change log (most recent first)

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