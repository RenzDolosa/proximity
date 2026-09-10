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
| `profiles`          | One row per login account (`auth.users` 1:1). `role` = `admin`, `manager`, or `viewer`. `access_scope` = `all`, `employee_manager`, or `scanner` — which *sections* the account can open at all. Together these two columns drive every permission in the system. |
| `employees`          | **Employee Manager.** Master employee record. Requires `employee_code` **and** `proximity_card_id` (every employee must have exactly one proximity card — enforced `NOT NULL` + unique). Also holds `scan_logs jsonb`, an append-only array every matched scan writes into. |
| `proximity_cards`    | **Proximity table.** Standalone inventory of issued `proximity_code`s. **Does not require an employee** — a card can be issued and sit unassigned until linked from Employee Manager. |
| `scan_events`        | **Proximity Scanner log.** Foreign key to `employees`. Every scan attempt is recorded here — `matched`, `unmatched`, `inactive_card`, `inactive_employee`, or `unassigned_card` (a live card nobody is linked to yet). |
| `employee_directory` | View: employee joined to their required proximity card + scan totals, for the Employee Manager grid. |
| `scan_feed`          | View: `scan_events` joined to employee name, for the live activity feed. |

**Relationship direction:** `employees.proximity_card_id → proximity_cards.id`
(not the other way around). This lets you pre-issue a batch of blank cards
as inventory, and only requires a link once an employee is actually
provisioned with one.

### Permission model

Two independent dimensions:
- **Role** — what an account is allowed to *edit*.
- **Access scope** — which *sections* an account can even open.

| Action                          | admin | manager | viewer |
|----------------------------------|:---:|:---:|:---:|
| View employees / cards / scans (within their scope) | ✅ | ✅ | ✅ |
| Add / edit employees              | ✅ | ✅ | ❌ |
| Delete employees                  | ✅ | ❌ | ❌ |
| Issue / revoke proximity cards    | ✅ | ✅ | ❌ |
| Delete an unassigned proximity card | ✅ | ❌ | ❌ |
| Perform a scan (if scope allows)  | ✅ | ✅ | ✅ |
| Manage user accounts / roles      | ✅ | ❌ | ❌ |

| Access scope        | Can open                          |
|----------------------|-----------------------------------|
| `all`                | Everything their role permits     |
| `employee_manager`   | Employee Manager + Proximity Cards only — **no Scanner** |
| `scanner`            | Scanner only — **no directory, no cards** |

Admins always behave as full-scope regardless of the stored value.
Enforced with Postgres Row Level Security, not just hidden in the UI — every
table has RLS on; policies call `is_admin()` / `is_admin_or_manager()` /
`can_view_employee_manager()` / `can_view_scanner()`, all reading the
caller's own `profiles` row.

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
signup after that defaults to `viewer` / scope `all` — an admin adjusts role
and access from the **Users & Roles** screen.

### Managing users (admin only)

The **Users & Roles** screen supports:
- **Add user** — name, email, password, role, access scope. Creates a real
  Supabase Auth account (not self-signup).
- **Edit** — name, email, role, access scope.
- **Reset password** — sets a new password for that account directly.
- **Enable / disable** — soft-locks the account (`profiles.is_active`); wire
  this into your own login gate if you want disabled accounts fully blocked.

Creating accounts, changing someone else's email, and resetting passwords
all require the Supabase **service role key** (`auth.admin.*`), which must
never be shipped to the browser. Those three actions go through the
`admin-users` Edge Function instead, which re-checks the caller is really an
admin (via their own JWT) before touching anything.

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

- Edge Function `admin-users` is deployed for the account-management
  actions above (`create`, `update`, `reset_password`). Called from the UI
  via `supabase.functions.invoke('admin-users', ...)`; admin-only, enforced
  server-side.

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
