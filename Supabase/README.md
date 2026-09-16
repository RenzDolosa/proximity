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

## Storage

| Bucket | Purpose |
| --- | --- |
| `scan-sounds` | Public bucket, 5 fixed **extension-less** object keys: `matched-in`, `matched-out`, `card-revoked`, `unmatched`, `unassigned-card`. Uploaded/replaced from the **Settings** page (`JS/Features/Settings/SettingsPage.js` → `JS/Models/ScanSoundsModel.js`) by admins and by managers whose `access_scope` covers Scanner (see Permission model below); played back from `JS/Features/Scanner/StandaloneScanner.js` and `TestScanPage.js` via `JS/Utils/scanSounds.js`. |

Fixed keys + `upsert: true` on upload mean "replace" always overwrites the
same object — no orphaned old file across a format change (mp3 → wav
etc.), unlike the Drive photo flow which has to track and delete an old
file id explicitly. `contentType` is set from the uploaded file's own
`file.type` at upload time (not inferred from a file extension, since
there isn't one), so `<audio src>` playback works purely off the
`Content-Type` response header. `file_size_limit` is 5MB;
`allowed_mime_types` covers the common audio formats
(`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`, `audio/aac`).

Storage RLS on `storage.objects` (four policies, `bucket_id = 'scan-sounds'`):
insert/update/delete require `public.can_manage_scan_sounds()` (admins, and
managers whose `access_scope` is `all` or `scanner`); select is open to any
`authenticated` caller (needed for `list()`/`getPublicUrl()` from within
the app — this already covered Viewers before the Settings capacity panel
existed to use it). The bucket's own `public = true` flag is what lets the actual
audio bytes be fetched with **no auth at all** at playback time — that's
independent of the `storage.objects` RLS policies above, which only gate
the authenticated Storage API calls (list/upload/remove), not the public
object-serving endpoint.

Client-side cache-busting: the object path never changes on replace
(same upsert path), so `JS/Utils/scanSounds.js` appends
`?v=<object's updated_at>` to the public URL — same reasoning as
`avatarHTML()`'s `cb` param for employee photos, otherwise a browser that
already fetched `matched-in` once could keep playing the old clip after
an admin swaps it out.

## RPC

- **`scan_proximity_code(p_proximity_code, p_scanner_id)`** — looks up the
  card, resolves the linked employee, classifies the result, inserts a
  `scan_events` row (even on failure), and a trigger appends matched scans
  into that employee's `scan_logs`. Returns `direction` (`in`/`out`) on a
  matched result, derived from the parity of `scan_logs`'s length *before*
  this scan is appended (even count so far → `in`, odd → `out`) — a plain
  in/out toggle per employee, not tied to any real door-side sensor.
  Called from `JS/Models/ScanEventsModel.js#scan` (standalone/logging
  Scanner tab).
- **`test_scan_proximity_code(...)`** — same lookup/classification logic
  (including the same `direction` preview on a matched result, added
  2026-09-15 — see change log), but never writes to `scan_events` or
  `scan_logs`. Backs the in-shell **Test Scan** page so admins/managers can
  dry-run a code, including its sound and IN/OUT badge, without polluting
  the real activity log.
- **`get_scan_feed()`** — `SECURITY DEFINER` function backing the Recent
  Activity feed (see `scan_feed` above).
- **`add_employee_remark(...)`** — appends a `{remark, created_by,
  created_by_id, created_at}` entry to `employees.remarks_log`.
- **`is_admin()` / `is_admin_or_manager()`** — role helper functions used
  throughout RLS policies.
- **`can_view_settings()` / `can_manage_scan_sounds()`** — the Settings
  page's own permission checks, layered on top of `access_scope` rather
  than duplicating it (see Permission model below). Used by the
  `scan-sounds` write RLS policies and by `upload-employee-photo`'s
  `quota` action.

## Permission model (enforced via Postgres RLS, not just hidden in the UI)

Two independent dimensions, mirrored in `JS/Core/state.js`:

- **Role** (`admin`/`manager`/`viewer`) — what an account can *edit*.
- **Access scope** (`all`/`employee_manager`/`scanner`) — which *sections*
  an account can open at all. Admins always behave as full-scope.

RLS policies call `is_admin()` / `is_admin_or_manager()` /
`can_view_employee_manager()` / `can_view_scanner()`, each reading the
caller's own `profiles` row.

**Settings** (`JS/Features/Settings/SettingsPage.js`) reuses this same
`role` + `access_scope` pair rather than adding a third dimension:
- `can_view_settings()` — true for admins, or for `manager`/`viewer`
  accounts whose `access_scope` is `all`, `employee_manager`, or
  `scanner` (i.e. covers at least one Settings-relevant module). Gates
  whether the account can open Settings at all, and which of its two
  panels render (`employee_manager` scope → Employee photos panel only;
  `scanner` scope → Scan sounds panel only; `all` → both).
- `can_manage_scan_sounds()` — true for admins, or for `manager` accounts
  whose `access_scope` is `all` or `scanner`. Gates upload/replace/remove
  on the Scan sounds panel specifically — `viewer` accounts always get a
  read-only panel (still see the capacity bar and can preview) regardless
  of scope, matching the `role` axis's edit-vs-view meaning everywhere
  else in this table.
Mirrored client-side in `JS/Core/state.js` as `canViewSettings()` /
`settingsShowSounds()` / `settingsShowPhotos()` / `canManageScanSounds()`
— the client checks decide what renders, the RPC/RLS checks are what
actually enforce it if someone bypasses the UI.

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
- **`upload-employee-photo`** — uploads an employee photo to Google Drive,
  and (a `quota` action, added 2026-09-16) reports the connected Drive
  account's storage usage/limit for Settings' Employee photos capacity
  panel. Always writes the file under a **new UUID filename** rather than
  overwriting the previous one in place — Google's thumbnail CDN caches by
  file ID, so an in-place update kept serving the stale photo. `verify_jwt: true`.
  Auth is per-action: `upload`/`delete` require `is_admin_or_manager()` (unchanged);
  `quota` only requires `can_view_settings()` since it's read-only, so a
  Viewer with Settings access can see it too. Request/response contract for
  `upload`/`delete` is otherwise unchanged, but the client
  (`JS/Models/EmployeesModel.js#uploadPhoto`) now POSTs via a raw
  `XMLHttpRequest` instead of `supabase.functions.invoke()`, purely to get
  real `upload.onprogress` events for the Employee Manager's photo
  progress bar — `invoke()` is `fetch()`-based and only resolves once the
  whole round trip finishes, same limitation noted for CSV import.

See `functions/proximity-scan/README.md`, `functions/admin-users/README.md`,
and `functions/upload-employee-photo/README.md` for the request/response
contracts each client-side caller relies on.

---
*Last reconciled against `Supabase:list_tables` (verbose),
`Supabase:list_edge_functions`, `storage.buckets`, and
`pg_get_functiondef()` on the live `kjwttqmbcjvkivgmwuev` project,
2026-09-15. Re-verify against those before trusting this file blindly in a
future session — schema, Storage, and functions evolve independently of
git commits here since nothing is deployed *from* this repo yet.*

### Change log (most recent first)

**2026-09-16 — Settings permission scoping (`can_view_settings()` / `can_manage_scan_sounds()`) + `upload-employee-photo` `quota` action**
- Settings now opens for any account whose `access_scope` covers a
  Settings-relevant module, not just admins — reusing the existing
  `role`/`access_scope` pair (see Permission model above) instead of a
  new column. `employee_manager` scope shows only the Employee photos
  panel, `scanner` scope shows only Scan sounds, `all` shows both.
- Added `can_manage_scan_sounds()` and `can_view_settings()` SQL
  functions; replaced the `scan-sounds` bucket's 3 admin-only write RLS
  policies (`scan_sounds_admin_write/update/delete`) with
  `scan_sounds_manage_insert/update/delete`, now checking
  `can_manage_scan_sounds()` so managers with covering scope can
  upload/replace/remove sounds too, not just admins. The read policy was
  already open to any authenticated caller and didn't need to change.
- `upload-employee-photo` gained a `quota` action (Drive `about.get` ->
  `storageQuota`) and switched from one blanket auth check to a
  per-action one — `quota` needs only `can_view_settings()`, `upload`/
  `delete` keep the original `is_admin_or_manager()` — so Settings'
  Employee photos capacity panel works for Viewers with Settings access,
  without loosening who can actually write photos.
- Added `MAX_FILE_SIZE_BYTES` export to `ScanSoundsModel.js` and a
  `fmtBytes()` helper to `Utils/format.js` for both panels' capacity math.

**2026-09-15 — `scan-sounds` Storage bucket + `test_scan_proximity_code()` direction fix**
- Added the `scan-sounds` public bucket and its 3 admin-only write RLS
  policies + 1 authenticated-read policy (see Storage section above).
- `CREATE OR REPLACE FUNCTION public.test_scan_proximity_code` — added the
  same `v_prior_count`/`v_direction` parity computation
  `scan_proximity_code()` already had, purely as a read-only preview
  (nothing written). Before this it always omitted `direction`, so a
  matched test scan could never show the IN/OUT badge in `ScanResultCard.js`
  or (once sounds shipped) play the IN vs. OUT sound — only a real scan
  through the logging scanner could. Ran `get_advisors` (security +
  performance) after both changes — nothing new flagged.