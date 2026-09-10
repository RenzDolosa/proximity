# Proximity — ID & Access System

A permission-based employee ID / proximity access system, built on Supabase
(Postgres + Auth + Edge Functions) with a single-file web console.

Live Supabase project: **`proximity`** (`kjwttqmbcjvkivgmwuev`)
Project URL: `https://kjwttqmbcjvkivgmwuev.supabase.co`

## 1. Architecture

```
┌─────────────────────┐        ┌──────────────────────────────────────────┐
│  index.html (SPA)    │  REST  │  Supabase Postgres                       │
│  - Auth (login/sign) │◄──────►│  - profiles          (login + role)      │
│  - Employee Manager  │  RLS   │  - employees         (Employee Manager)  │
│  - Proximity Cards   │        │  - proximity_cards   (Proximity table)   │
│  - Scanner           │        │  - scan_events        (Scanner log)      │
│  - Users & Roles     │        │  - employee_directory (read view)        │
└──────────┬───────────┘        │  - scan_feed          (read view)        │
           │ RPC                └──────────────────────────────────────────┘
           ▼
┌─────────────────────┐
│ Edge Function        │  For hardware/kiosk scanners that can't run the
│ proximity-scan       │  full JS SDK: POST { proximity_code, scanner_id }
└─────────────────────┘  with a Bearer JWT, calls the same scan_proximity_code() RPC.
```

## 2. Data model

| Table              | Purpose                                                                 |
|---------------------|--------------------------------------------------------------------------|
| `profiles`          | One row per login account (`auth.users` 1:1). `role` = `admin`, `manager`, or `viewer`. Drives every permission in the system. |
| `employees`          | **Employee Manager.** Master employee record, including `scan_logs jsonb` — an append-only array every scan writes into. |
| `proximity_cards`    | **Proximity table.** `proximity_code` (the physical/virtual ID) with a foreign key to `employees`. Only one *active* card per code is allowed. |
| `scan_events`        | **Proximity Scanner log.** Foreign key to `employees`. Every scan attempt is recorded here, matched or not. |
| `employee_directory` | View: employee + their live proximity code + scan totals, for the Employee Manager grid. |
| `scan_feed`          | View: `scan_events` joined to employee name, for the live activity feed. |

### Permission model

| Action                          | admin | manager | viewer |
|----------------------------------|:---:|:---:|:---:|
| View employees / cards / scans   | ✅ | ✅ | ✅ |
| Add / edit employees              | ✅ | ✅ | ❌ |
| Delete employees                  | ✅ | ❌ | ❌ |
| Issue / revoke proximity cards    | ✅ | ✅ | ❌ |
| Delete proximity cards            | ✅ | ❌ | ❌ |
| Perform a scan                    | ✅ | ✅ | ✅ |
| Manage user accounts / roles      | ✅ | ❌ | ❌ |

Enforced with Postgres Row Level Security — not just hidden in the UI. Every
table has `RLS` on; policies call `is_admin()` / `is_admin_or_manager()`
helper functions that read the caller's own `profiles.role`.

### How a scan works end-to-end

1. Scanner UI (or a kiosk hitting the `proximity-scan` Edge Function) calls
   the `scan_proximity_code(p_proximity_code, p_scanner_id)` RPC.
2. The function looks up `proximity_cards` by code, resolves the linked
   `employees` row, and classifies the result: `matched`, `unmatched`,
   `inactive_card`, or `inactive_employee`.
3. It inserts one row into `scan_events` (always — even failed scans are
   logged for audit).
4. A trigger (`trg_append_scan_log`) fires on that insert and, for `matched`
   scans, appends `{scan_id, proximity_code, scanner_id, scanned_at, result}`
   into that employee's `employees.scan_logs` jsonb array.
5. The RPC returns the employee record (or the failure reason) to the UI,
   which displays it immediately.

### First account

The very first person to sign up automatically becomes `admin`
(`handle_new_auth_user()` trigger checks if `profiles` is empty). Every
signup after that defaults to `viewer` — an admin promotes people from the
**Users & Roles** screen.

## 3. Files

- `index.html` — the entire web console (auth, directory, cards, scanner,
  user management). No build step: open it in a browser, or host it
  anywhere static (Vercel, Netlify, GitHub Pages, S3). It talks directly to
  Supabase using the project's public anon key (safe to expose — RLS is
  what actually protects the data).
- Edge Function `proximity-scan` is already deployed to the Supabase
  project for kiosk/hardware integrations that POST JSON instead of using
  the JS SDK:

  ```
  POST https://kjwttqmbcjvkivgmwuev.supabase.co/functions/v1/proximity-scan
  Authorization: Bearer <user's access_token>
  Content-Type: application/json

  { "proximity_code": "PRX-00021", "scanner_id": "front-door-01" }
  ```

## 4. Running it

1. Open `index.html` directly in a browser (double-click, or `npx serve .`).
2. Sign up — your first account becomes admin.
3. Add employees in **Employee Manager**, issue them a code in
   **Proximity Cards**, then scan that code in **Scanner**.

## 5. Suggested next steps

- Wire real hardware (RFID/NFC/QR readers) to call the `proximity-scan`
  Edge Function on each read.
- Add email confirmation / SSO in Supabase Auth settings if this goes to
  production (currently plain email+password).
- Set up a scheduled job to purge or archive very old `scan_events` rows if
  scan volume gets large; `employees.scan_logs` is unbounded jsonb and
  should also get an archival/trim policy at scale.
