# Supabase

Reference material for the live Supabase project this app talks to
(`proximity`, `kjwttqmbcjvkivgmwuev`). The actual schema, RLS policies, and
Edge Function source live in the Supabase project itself — nothing here is
deployed *from* this repo (yet). This folder is where that should move to
once you want it version-controlled, e.g. via:

```
supabase login
supabase link --project-ref kjwttqmbcjvkivgmwuev
supabase db pull          # writes a migration under Supabase/migrations/
supabase functions download proximity-scan --project-ref kjwttqmbcjvkivgmwuev
supabase functions download admin-users --project-ref kjwttqmbcjvkivgmwuev
supabase functions download upload-employee-photo --project-ref kjwttqmbcjvkivgmwuev
```

## Tables

| Table                       | Purpose                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`                   | One row per login account (`auth.users` 1:1). `role` = `admin` / `manager` / `viewer`. `access_scope` = `all` / `employee_manager` / `scanner` — which sections the account can open at all. `is_active` — soft-disable; checked at boot, force signs out if false or missing. |
| `employees`                  | Master employee record. Requires `employee_code` **and** `proximity_card_id` (NOT NULL + unique — every employee has exactly one card). `status` = `active`/`inactive`/`suspended`. `scan_logs` jsonb — append-only, written by `trg_append_scan_log` on every matched scan. `remarks_log` jsonb — append-only notes, written via `add_employee_remark()`. `photo_url` / `photo_file_id` — Drive-hosted photo; `photo_file_id` changes to a fresh UUID on every replace (see Edge Functions below). |
| `proximity_cards`             | Standalone card inventory. Does **not** require an employee — a card can be issued and sit unassigned until linked from Employee Manager. `is_active` + `revoke_reason` for revoked cards.               |
| `scan_events`                 | FK to `employees` and `proximity_cards`. Every scan attempt is logged: `matched`, `unmatched`, `inactive_card`, `inactive_employee`, or `unassigned_card`.                                                |
| `employee_directory` (view)  | Employee joined to required card + scan totals, for the Employee Manager grid. Runs `SECURITY DEFINER` so scanner-only / restricted roles still see joined rows under RLS. Read by `JS/Models/EmployeesModel.js#listDirectory`. |
| `scan_feed` (view / function) | `get_scan_feed()` — `SECURITY DEFINER` function (originally a plain view, which silently dropped employee joins for scanner-only accounts under invoker RLS; replaced for that reason). Read by `JS/Models/ScanEventsModel.js#recentFeed`. |

Relationship direction: `employees.proximity_card_id → proximity_cards.id`.

## RPC

- **`scan_proximity_code(p_proximity_code, p_scanner_id)`** — looks up the
  card, resolves the linked employee, classifies the result, inserts a
  `scan_events` row (even on failure), and a trigger appends matched scans
  into that employee's `scan_logs`. Called from
  `JS/Models/ScanEventsModel.js#scan` (standalone/logging Scanner tab).
- **`test_scan_proximity_code(...)`** — same lookup/classification logic,
  but never writes to `scan_events` or `scan_logs`. Backs the in-shell
  **Test Scan** page so admins/managers can dry-run a code without polluting
  the real activity log.
- **`get_scan_feed()`** — `SECURITY DEFINER` function backing the Recent
  Activity feed (see `scan_feed` above).
- **`add_employee_remark(...)`** — appends a `{remark, created_by,
  created_by_id, created_at}` entry to `employees.remarks_log`.
- **`is_admin()` / `is_admin_or_manager()`** — role helper functions used
  throughout RLS policies.

## Permission model (enforced via Postgres RLS, not just hidden in the UI)

Two independent dimensions, mirrored in `JS/Core/state.js`:

- **Role** (`admin`/`manager`/`viewer`) — what an account can *edit*.
- **Access scope** (`all`/`employee_manager`/`scanner`) — which *sections*
  an account can open at all. Admins always behave as full-scope.

RLS policies call `is_admin()` / `is_admin_or_manager()` /
`can_view_employee_manager()` / `can_view_scanner()`, each reading the
caller's own `profiles` row.

**Known gotcha:** a plain view runs under the *invoker's* RLS, not the
definer's — so a view joining `employees` will silently drop rows for a
role that can't directly read `employees`, even if the view itself is
grantable. The fix used here is `SECURITY DEFINER` functions (`get_scan_feed()`)
rather than plain views, for anything that needs to join across a
table a restricted role can't see directly.

## Edge Functions

- **`proximity-scan`** — for hardware/kiosk scanners that can't run the JS
  SDK. `POST { proximity_code, scanner_id }` with a Bearer JWT; calls the
  same `scan_proximity_code()` RPC server-side. `verify_jwt: true`.
- **`admin-users`** — the only path for `create` / `update` /
  `reset_password` / `delete` on login accounts, since those need the
  service-role key (`auth.admin.*`), which must never reach the browser.
  Re-checks the caller is really an admin (via their own JWT) before doing
  anything, and guards against an admin deleting their own account. Called
  from `JS/Models/ProfilesModel.js#callAdminUsers`. `verify_jwt: true`.
- **`upload-employee-photo`** — uploads an employee photo to Google Drive.
  Always writes the file under a **new UUID filename** rather than
  overwriting the previous one in place — Google's thumbnail CDN caches by
  file ID, so an in-place update kept serving the stale photo. `verify_jwt: true`.
  Request/response contract is unchanged, but the client
  (`JS/Models/EmployeesModel.js#uploadPhoto`) now POSTs via a raw
  `XMLHttpRequest` instead of `supabase.functions.invoke()`, purely to get
  real `upload.onprogress` events for the Employee Manager's photo
  progress bar — `invoke()` is `fetch()`-based and only resolves once the
  whole round trip finishes, same limitation noted for CSV import.

See `functions/proximity-scan/README.md`, `functions/admin-users/README.md`,
and `functions/upload-employee-photo/README.md` for the request/response
contracts each client-side caller relies on.

---
*Last reconciled against `Supabase:list_tables` (verbose) and
`Supabase:list_edge_functions` on the live `kjwttqmbcjvkivgmwuev` project,
2026-09-14. Re-verify against those tools before trusting this file blindly
in a future session — schema and functions evolve independently of git
commits here since nothing is deployed *from* this repo yet.*