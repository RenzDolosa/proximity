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
  main.js                     bootstrap: wires auth-state changes, boots the session
  Core/                       app-wide plumbing, not tied to any one feature
    supabaseClient.js            the one Supabase client instance
    state.js                     session/profile/route state + permission checks
    router.js                    route table, render dispatch, nav wiring
    screens.js                   top-level screen switch (auth / shell / standalone scanner)
  Models/                     one file per Supabase table/view, all built on BaseModel
    BaseModel.js                 reusable list/get/create/update/remove factory
    EmployeesModel.js
    ProximityCardsModel.js
    ProfilesModel.js
    ScanEventsModel.js
  Components/                 reusable UI pieces used by more than one feature
    Modal.js                     shared openModal/closeModal scaffold — every
                                  dialog below is built on this so they all
                                  share the same structure and behavior
    EmployeeModal.js
    ProximityCardModal.js
    UserModal.js
    ResetPasswordModal.js
    ScanLogModal.js
    ScanResultCard.js
    ScanFeed.js
  Features/                   one folder per screen/area of the app
    Auth/AuthScreen.js
    Directory/DirectoryPage.js       (Employee Manager)
    Proximity/ProximityPage.js       (Proximity Cards)
    Scanner/ScannerPage.js           (in-shell launcher + activity)
    Scanner/StandaloneScanner.js     (the ?scanner=1 tab)
    Users/UsersPage.js               (Users & Roles, admin-only)
    Users/userOptions.js             (shared role/access-scope option lists)
  Utils/                      pure helpers, no state, no DOM assumptions
    dom.js                       $ / $$
    format.js                    esc / initials / fmtTime
    toast.js                     toast notifications

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
    proximity-scan/README.md     request/response contract
    admin-users/README.md        request/response contract
```

No build step: everything is native ES modules and a couple of plain
`<script>` tags. `JS/main.js` is loaded as `type="module"`, which browsers
refuse to run from a `file://` URL — so serve the `Public/` folder over
HTTP (see below) rather than double-clicking `index.html`.

## 2. Architecture

```
┌─────────────────────┐        ┌──────────────────────────────────────────┐
│  Public/index.html   │  REST  │  Supabase Postgres                       │
│  + JS/* modules       │◄──────►│  - profiles          (login + role)      │
│  - Auth (login/sign)  │  RLS   │  - employees         (Employee Manager)  │
│  - Employee Manager   │        │  - proximity_cards   (Proximity table)   │
│  - Proximity Cards    │        │  - scan_events        (Scanner log)      │
│  - Scanner            │        │  - employee_directory (read view)        │
│  - Users & Roles      │        │  - scan_feed          (read view)        │
└──────────┬───────────┘        └──────────────────────────────────────────┘
           │ RPC
           ▼
┌─────────────────────┐
│ Edge Function         │  For hardware/kiosk scanners that can't run the
│ proximity-scan        │  full JS SDK: POST { proximity_code, scanner_id }
└─────────────────────┘  with a Bearer JWT, calls the same scan_proximity_code() RPC.
```

Full schema, RPC, and permission-model details: [`Supabase/README.md`](./Supabase/README.md).

## 3. Running it

```
npx serve Public
```

Then open the printed URL. Sign up — your first account becomes admin. Add
employees in **Employee Manager**, issue them a code in **Proximity
Cards**, then scan that code in **Scanner**.

## 4. Suggested next steps

- Wire real hardware (RFID/NFC/QR readers) to call the `proximity-scan`
  Edge Function on each read.
- Pull the live schema and Edge Function source into `Supabase/` (see that
  folder's README for the `supabase` CLI commands) so they're
  version-controlled alongside the client.
- Add email confirmation / SSO in Supabase Auth settings if this goes to
  production (currently plain email+password).
- Set up a scheduled job to purge or archive very old `scan_events` rows if
  scan volume gets large; `employees.scan_logs` is unbounded jsonb and
  should also get an archival/trim policy at scale.
- Replace the placeholder SVGs in `Public/Assets/Favicon` and
  `Public/Assets/Icon` with real brand assets.
