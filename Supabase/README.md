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
| `employees` | Master employee record. Requires `employee_code` **and** `proximity_card_id` (NOT NULL + unique — every employee has exactly one card). Also holds `scan_logs jsonb` (appended on every matched scan) and `remarks_log jsonb` (general notes; `revoke_proximity_card()` writes into it automatically when a linked card is revoked). |
| `proximity_cards` | Standalone card inventory. Does **not** require an employee — a card can be issued and sit unassigned until linked from Employee Manager. `revoke_reason` holds the reason given at revoke time. |
| `scan_events` | FK to `employees`. Every scan attempt is logged: `matched`, `unmatched`, `inactive_card`, `inactive_employee`, or `unassigned_card`. |
| `employee_directory` (view) | Employee joined to required card + scan totals + remarks counts, for the Employee Manager grid — read by `JS/Models/EmployeesModel.js#listDirectoryPage`. |
| `scan_feed` (view) | `scan_events` joined to employee name, for the live activity feed. |
| `proximity_card_directory` (view) | Card joined to its assignee (if any), for the Proximity Cards grid — read by `JS/Models/ProximityCardsModel.js#listDirectoryPage`. |
| `unassigned_active_proximity_cards` (view) | Active cards nobody is linked to yet — the pool the Employee modal's card picker offers. |

Relationship direction: `employees.proximity_card_id → proximity_cards.id`.

## RPC

- `scan_proximity_code(p_proximity_code, p_scanner_id)` — looks up the card,
  resolves the linked employee, classifies the result, inserts a
  `scan_events` row (even on failure), and a trigger appends matched scans
  into that employee's `scan_logs`. Called from
  `JS/Models/ScanEventsModel.js#scan`.
- `test_scan_proximity_code(p_proximity_code)` — same lookup, never logs
  anything (Test Scan page).
- `get_scan_feed(p_limit, p_scanner_id)` — recent scan activity, employee
  name pre-joined server-side (`SECURITY DEFINER`, so it resolves
  regardless of the caller's RLS scope).
- `revoke_proximity_card(p_card_id, p_reason)` — deactivates the card and,
  if it's currently linked to an employee, appends a `remarks_log` entry on
  that employee in the exact shape `add_employee_remark()` produces (`{id,
  remark, created_by, created_by_id, created_at, resolved}`), so a
  revocation reason shows up as an ordinary (resolvable) remark. Called
  from `JS/Models/ProximityCardsModel.js#revoke`.
- `delete_unassigned_proximity_cards()` — admin-only, deletes every card
  with no employee attached in one statement. Called from
  `JS/Models/ProximityCardsModel.js#deleteAllUnassigned`.
- `add_employee_remark(p_employee_id, p_remark)` /
  `resolve_employee_remark(p_employee_id, p_remark_id, p_resolved)` —
  general-purpose notes on an employee. Called from
  `JS/Models/EmployeesModel.js#addRemark`/`#resolveRemark`.

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
