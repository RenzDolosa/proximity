# Supabase

Reference material for the live Supabase project this app talks to
(`proximity`, `kjwttqmbcjvkivgmwuev`). The actual schema, RLS policies, and
Edge Function source live in the Supabase project itself — nothing here is
deployed from this repo (yet). This folder is where that should move to
once you want it version-controlled, e.g. via:

```
supabase login
supabase link --project-ref kjwttqmbcjvkivgmwuev
supabase db pull          # writes a migration under Supabase/migrations/
supabase functions download proximity-scan --project-ref kjwttqmbcjvkivgmwuev
supabase functions download admin-users --project-ref kjwttqmbcjvkivgmwuev
```

## Tables

| Table | Purpose |
|---|---|
| `profiles` | One row per login account (`auth.users` 1:1). `role` = `admin` / `manager` / `viewer`. `access_scope` = `all` / `employee_manager` / `scanner` — which sections the account can open at all. |
| `employees` | Master employee record. Requires `employee_code` **and** `proximity_card_id` (NOT NULL + unique — every employee has exactly one card). Also holds `scan_logs jsonb`, appended to on every matched scan. |
| `proximity_cards` | Standalone card inventory. Does **not** require an employee — a card can be issued and sit unassigned until linked from Employee Manager. |
| `scan_events` | FK to `employees`. Every scan attempt is logged: `matched`, `unmatched`, `inactive_card`, `inactive_employee`, or `unassigned_card`. |
| `employee_directory` (view) | Employee joined to required card + scan totals, for the Employee Manager grid — this is what `JS/Models/EmployeesModel.js#listDirectory` reads. |
| `scan_feed` (view) | `scan_events` joined to employee name, for the live activity feed — read by `JS/Models/ScanEventsModel.js#recentFeed`. |

Relationship direction: `employees.proximity_card_id → proximity_cards.id`.

## RPC

`scan_proximity_code(p_proximity_code, p_scanner_id)` — looks up the card,
resolves the linked employee, classifies the result, inserts a `scan_events`
row (even on failure), and a trigger appends matched scans into that
employee's `scan_logs`. Called from `JS/Models/ScanEventsModel.js#scan`.

## Permission model (enforced via Postgres RLS, not just hidden in the UI)

Two independent dimensions, mirrored in `JS/Core/state.js`:
- **Role** (`admin`/`manager`/`viewer`) — what an account can *edit*.
- **Access scope** (`all`/`employee_manager`/`scanner`) — which *sections*
  an account can open at all. Admins always behave as full-scope.

RLS policies call `is_admin()` / `is_admin_or_manager()` /
`can_view_employee_manager()` / `can_view_scanner()`, each reading the
caller's own `profiles` row.

## Edge Functions

- **`proximity-scan`** — for hardware/kiosk scanners that can't run the JS
  SDK. `POST { proximity_code, scanner_id }` with a Bearer JWT; calls the
  same `scan_proximity_code()` RPC server-side.
- **`admin-users`** — the only path for `create` / `update` / `reset_password`
  on login accounts, since those need the service-role key
  (`auth.admin.*`), which must never reach the browser. Re-checks the
  caller is really an admin (via their own JWT) before doing anything.
  Called from `JS/Models/ProfilesModel.js#callAdminUsers`.

See `functions/proximity-scan/README.md` and `functions/admin-users/README.md`
for the request/response contracts each client-side caller relies on.
