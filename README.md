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
  scanner.css                 in-shell scanner + standalone scanner tab
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
                                       non-logging test_scan_proximity_code() RPC)
    Scanner/StandaloneScanner.js     (the real, logging ?scanner=1 tab)
    Users/UsersPage.js               (Users & Roles, admin-only; delete wired
                                       through admin-users v3+ w/ self-delete guard)
    Users/userOptions.js             (shared role/access-scope option lists)
  Utils/                      pure helpers, no state, no DOM assumptions
    dom.js                       $ / $$
    format.js                    esc / initials / fmtTime
    toast.js                     toast notifications
    csv.js                       parseCSV / toCSV, used by ImportModal.js

Public/
  index.html                  the app shell (static markup only — all
                               behavior lives in JS/*). References ../CSS
                               and ../JS.
  Assets/
    Favicon/favicon.svg
    Icon/icon.svg
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
└──────────┬─────────────┘        └──────────────────────────────────────────┘
           │ RPC / Edge Functions
           ▼
┌────────────────────────────┐
│ proximity-scan               │  Hardware/kiosk scanners that can't run the JS
│                               │  SDK: POST { proximity_code, scanner_id } +
│                               │  Bearer JWT → scan_proximity_code() RPC
├────────────────────────────┤
│ admin-users                   │  Admin-only create/update/reset_password/
│                               │  delete on login accounts (needs service-role
│                               │  key, never exposed to the browser)
├────────────────────────────┤
│ upload-employee-photo         │  Employee photo upload; always writes a new
│                               │  UUID-named file (never overwrites in place)
│                               │  so the CDN never serves a stale thumbnail
└────────────────────────────┘
```

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
2026-09-14. If you're another Claude instance picking this project up: fetch
`github.com/RenzDolosa/proximity` fresh (via web_search + web_fetch, or the
GitHub connector) and re-verify against `Supabase:list_tables` /
`list_edge_functions` before making schema or Edge Function claims — this
file can drift from the live state between sessions.*