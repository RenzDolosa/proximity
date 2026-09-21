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
| `employees`                  | Master employee record. Requires `employee_code` **and** `proximity_card_id` (NOT NULL + unique — every employee has exactly one card). `status` = `active`/`inactive`/`suspended`. `scan_logs` jsonb — append-only, written by `trg_append_scan_log` on every matched scan. `remarks_log` jsonb — append-only notes, written via `add_employee_remark()`. `photo_url` / `photo_file_id` — Drive-hosted photo; `photo_file_id` changes to a fresh UUID on every replace (see Edge Functions below). `photo_thumb_b64` — small base64 thumbnail (added 2026-09-18), fetched server-side by `upload-employee-photo` at upload time; format is whatever Drive's `/thumbnail` endpoint returns (PNG or JPEG, not always JPEG despite this column's original 2026-09-18 write-up assuming so — client-side callers now sniff the real format rather than trusting a hardcoded label, see root `README.md`'s 2026-09-19 change log entry); feeds the offline Scanner's `offlineAvatarHTML()` with zero network requests — see "Offline scanning" below. |
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

- **`scan_proximity_code(p_proximity_code, p_scanner_id, p_scanned_at, p_offline)`**
  — looks up the card, resolves the linked employee, classifies the
  result, inserts a `scan_events` row (even on failure), and a trigger
  appends matched scans into that employee's `scan_logs`. Returns
  `direction` (`in`/`out`) on a matched result, derived from the parity of
  `scan_logs`'s length *before* this scan is appended (even count so far
  → `in`, odd → `out`) — a plain in/out toggle per employee, not tied to
  any real door-side sensor. `p_scanned_at` (default `now()`) and
  `p_offline` (default `false`) were added 2026-09-16 — both optional and
  backward compatible, so the existing 2-arg calls from
  `proximity-scan`/`JS/Models/ScanEventsModel.js#scan` are untouched.
  `p_scanned_at` lets a scan captured offline and replayed later keep its
  true original timestamp (the `trg_append_scan_log` trigger reads
  `NEW.scanned_at`, so `scan_logs` inherits the correct time too);
  `p_offline: true` tags the resulting row's `raw_payload` with
  `{"captured_offline": true}` purely for audit visibility — e.g. spotting
  that a since-revoked card was actually tapped while the kiosk was
  offline, before the cache caught up. See "Offline scanning" below.
- **`get_scanner_offline_cache()`** — added 2026-09-16. Returns a trimmed
  `proximity_cards` ⨝ `employees` projection (code, active flags,
  employee id/name/code/department/position, and current `scan_count` for
  direction parity) as a single `jsonb` array, for
  `JS/Models/OfflineScanModel.js` to cache client-side in IndexedDB. Same
  permission gate as the real scan RPC — deliberately trimmed to only the
  fields offline classification needs, not full employee rows, even
  though the calling roles (scanner-scope, in particular) couldn't
  otherwise `SELECT` `employees` directly at all. Did briefly also carry
  `photo_thumb_b64` (2026-09-18–2026-09-19); see
  `get_scanner_offline_photos()` immediately below for why that moved out.
- **`get_scanner_offline_photos()`** — added 2026-09-19. Split out of
  `get_scanner_offline_cache()` above: returns a **sparse**
  `[{employee_id, photo_thumb_b64}]` array — only employees who actually
  have a thumbnail on file, not the whole roster — so the lookup RPC
  above can stay small and get refreshed every 5 minutes without a
  growing photo payload riding along on every single one of those
  refreshes. Same permission gate. Client-side, refreshed on its own
  30-minute interval rather than 5 (`StandaloneScanner.js`), merged back
  into the lookup cache's rows by `employee_id` at read time
  (`OfflineScanModel.getCacheMeta()`) — see "Offline scanning" below.
- **`test_scan_proximity_code(...)`** — same lookup/classification logic
  (including the same `direction` preview on a matched result, added
  2026-09-15 — see change log), but never writes to `scan_events` or
  `scan_logs`. Backs the in-shell **Test Scan** page so admins/managers can
  dry-run a code, including its sound and IN/OUT badge, without polluting
  the real activity log. Does **not** take the offline-related params
  above — Test Scan has no offline support (see root `README.md`'s change
  log for why that's a deliberate scope boundary, not an oversight).
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

**2026-09-21 — Full RLS/RPC audit, one critical finding and fix.** An
external review raised general concerns about several tables/functions
without access to verify the live policies. Verified directly against
the live project (`pg_policies`, `pg_proc` definitions, actual grants via
`has_function_privilege`):
- **Critical, confirmed and fixed — `profiles` self-privilege-escalation.**
  `profiles_update_own_or_admin`'s RLS policy was `USING (id = auth.uid()
  OR is_admin())` with no explicit `WITH CHECK`. Per standard Postgres RLS
  semantics, an UPDATE policy with no `WITH CHECK` reuses `USING` for
  both — which only ever constrained WHICH ROW could be touched, never
  WHICH COLUMNS or VALUES. Net effect: any authenticated user, of any
  role, could call `supabase.from('profiles').update({ role: 'admin'
  }).eq('id', <their own auth.uid()>)` directly and it would succeed — a
  `viewer` account could self-promote straight to `admin`, entirely
  bypassing the app's UI. No trigger or other guard existed to catch
  this (`profiles` only had `trg_profiles_updated_at`). **Fixed** with a
  `BEFORE UPDATE` trigger (`prevent_self_privilege_escalation()`,
  `trg_profiles_prevent_self_escalation`) that blocks a non-admin from
  changing `role`/`access_scope`/`is_active` on any row, including their
  own — a trigger, not a `WITH CHECK` expression, because comparing
  proposed-NEW against actual-OLD column-by-column is exactly what
  triggers are for and RLS's `WITH CHECK` can't cleanly do. Explicitly
  exempts `auth.role() = 'service_role'`: `admin-users`' Edge Function
  does real role/`access_scope` writes via `auth.admin.*`, which requires
  the service-role key and therefore bypasses RLS — but triggers fire
  regardless of RLS bypass, so without this exemption the admin panel's
  own "change a user's role" feature would have broken the moment this
  landed.
- **Real, fixed — `scan_events` table was readable by ANY authenticated
  user, regardless of role.** `get_scan_feed()` (the RPC the app actually
  uses) was correctly gated by `is_admin() or can_view_scanner()` — but
  the underlying `scan_events` table's own SELECT policy was `qual:
  true`, so that RPC-level gate meant nothing: any authenticated client
  could just skip the RPC and query `scan_events` directly to read every
  scan across every employee. Confirmed via a full grep that the client
  codebase never actually does this (always goes through `get_scan_feed()`/
  `scan_proximity_code()`), so tightening it was a pure improvement with
  no legitimate access path broken — the table's SELECT policy now
  matches the RPC's own gate exactly (`is_admin() OR can_view_scanner()`).
- **Real, fixed, low-severity — two permission-helper functions
  (`can_manage_scan_sounds()`, `can_view_settings()`) were callable by
  `anon`** (unauthenticated), unlike every other helper in this table,
  which are all `authenticated`-only. Functionally harmless as found —
  both `coalesce(..., false)` on a null `auth.uid()` for anon — but
  inconsistent with the rest of this schema's lockdown for no reason.
  Revoked from `anon`/`public`, granted to `authenticated` only, matching
  everything else here.
- **Confirmed correct, no change needed:** every `SECURITY DEFINER`
  function's actual body (`add_employee_remark`,
  `delete_employee_scan_log`, `delete_unassigned_proximity_cards`,
  `resolve_employee_remark`, `revoke_proximity_card`, `scan_proximity_code`,
  `get_scan_feed`, `get_scanner_offline_cache`, `get_scanner_offline_photos`,
  and every `is_*`/`can_view_*` helper) checks authorization via
  `auth.uid()`-derived role/scope lookups, never a client-supplied
  parameter, and fails closed (`raise exception` or `coalesce(..., false)`)
  on anything unexpected. `get_scan_feed()`'s `p_scanner_id` in
  particular — flagged by the external review as worth checking — is
  confirmed to be a display filter only, not part of authorization; the
  actual gate is `is_admin() or can_view_scanner()`, independent of that
  parameter. Every function schema-qualifies its references and runs with
  `SET search_path TO 'public'` (a hardened, non-mutable value — not the
  literal empty-string convention Supabase's own docs show, but
  equivalent in effect here since `public` has no attacker-plantable
  objects; `public`'s default `CREATE` grant to `PUBLIC` was revoked at
  project setup, per Supabase's own default Postgres role setup).
- **Not fixed here, genuinely out of scope for a schema/RLS audit — flagged
  for the account owner to action directly in the Supabase Dashboard:**
  leaked-password protection (HaveIBeenPwned checking) is off in Auth
  settings. A Dashboard toggle, not something a SQL migration can reach.
- **Employee photos are public on Google Drive by design**, not a bug —
  `upload-employee-photo` explicitly sets "anyone with the link can
  view". Once a photo's Drive URL is known, Supabase RLS no longer
  governs access to it at all; that's a deliberate, pre-existing
  tradeoff for hot-linking Drive as a free photo host, not something this
  audit pass changed. Worth reconsidering only if employee photos are
  ever treated as confidential — not assumed here.
- **Follow-up review, same day: a GraphQL-hardening checklist (disable
  introspection, cap query depth/complexity, hide field-suggestion
  errors) doesn't actually apply to this project** — confirmed via
  `pg_extension`: `pg_graphql` isn't installed, so there's no GraphQL
  surface at all, let alone one with adjustable depth limits or field
  suggestions. Translated to what's real for a PostgREST+RPC API instead:
  - *Schema introspection* — PostgREST's own OpenAPI/Swagger spec at the
    API root is the actual equivalent surface (table/column/function
    shapes, not row data — RLS still gates that regardless). Confirmed
    already disabled for every role via `alter role authenticator set
    pgrst.openapi_mode to 'disabled'` (predates this entry — verified
    live, not re-applied).
  - *Unbounded response size* — no query-depth concept exists here since
    there's no client-composed nesting, only fixed foreign-key-declared
    embedding, but the underlying "one request returns everything" risk
    is real via a different path: no cap existed on rows returned by a
    single REST request. `statement_timeout=8s` (already set) guards
    against a request hanging, but not a fast query against a
    large/growing table (`scan_events`) returning an unbounded row count
    in that time. Added `pgrst.db_max_rows = 1000` — PostgREST returns
    `206 Partial Content` with a `Content-Range` header past this,
    signaling the client to paginate rather than silently truncating.
    Matches the row-count cap already planned client-side for Employee
    Manager/Proximity Cards/Users & Roles, just enforced at the DB level
    too regardless of what the client asks for.
  - *Field-suggestion/error-verbosity leakage* — PostgREST's error
    responses for a bad table/column name aren't a comparable leak to
    GraphQL's per-field "did you mean" suggestions; there's no equivalent
    setting to toggle here. The two layers that actually prevent
    schema-mapping-by-observation are the ones above: the API's schema
    listing is already unreachable (`openapi_mode=disabled`), and RLS
    means even a syntactically-valid guess against a real table/column
    still returns zero rows without proper auth — nothing further to
    change under this heading specifically.

## Offline scanning

Added 2026-09-16. Only the standalone kiosk Scanner
(`JS/Features/Scanner/StandaloneScanner.js`) has this — Test Scan is
unaffected (see its RPC entry above).

**Two separate problems, two separate mechanisms:**
1. *The app itself won't load with no network* — solved client-side only,
   by the Service Worker (`sw.js` at the repo root; see root `README.md`).
   Nothing in Postgres is involved in this half.
2. *A scan can't be classified or logged with no network* — solved by:
   - `get_scanner_offline_cache()` (see RPC section above) feeding a local
     IndexedDB copy of the card→employee lookup, refreshed opportunistically
     while online (on load, every 5 min, and right after reconnecting).
   - `get_scanner_offline_photos()` (added 2026-09-19 — see RPC section
     above and this file's change log) feeds a *separate* local IndexedDB
     cache of `employee_id -> photo_thumb_b64`, refreshed far less often
     (every 30 min, client-side — see root `README.md`). Split out of the
     lookup cache above on purpose: that one needs to stay small and
     frequent (card/employee status), while photos only change on
     re-upload and were only ever going to grow. `OfflineScanModel.js`'s
     `getCacheMeta()` merges the two back together by `employee_id`
     before anything else sees a row, so `classify()` (and everything
     downstream of it — `ScanResultCard.js`, `ScanFeed.js`) still just
     reads `photo_thumb_b64` off the row it's given, same as always. The
     client renders it directly as a `data:` URI via `offlineAvatarHTML()`
     (`Utils/format.js`) — no network request at all, online or offline:
     the thumbnail was already fetched server-side by `upload-employee-photo`
     once, at upload time (see `photo_thumb_b64`'s own change log entry,
     2026-09-18, for why that replaced an earlier Drive-prefetch approach).
   - Failed/offline scans get queued client-side (raw attempt only — code,
     scanner id, true timestamp — never a guessed result) and replayed
     **strictly one at a time, in original order** through the real
     `scan_proximity_code()` RPC once back online. Sequential replay is
     load-bearing, not just tidy: direction is derived from `scan_logs`'s
     length *at the moment each RPC call actually runs*, so two calls for
     the same employee racing in parallel could both read the same
     "before" count and both come back `in`.
   - Resync-on-reconnect no longer relies solely on the browser's `online`
     event (unreliable on some OS/browser/network combos, and easy to miss
     entirely on a backgrounded kiosk tab): a lightweight 20s poller
     (a no-op IndexedDB read when the queue is empty) and a
     `visibilitychange` listener both retry the flush independently. A
     sync that actually writes rows now also reloads Recent Activity —
     it previously only refreshed the lookup cache, so newly-synced scans
     didn't appear until something else happened to reload the feed.

**What this does *not* solve:** the lookup cache is a snapshot — it can't
see a card revoked, or a scan made on a *different* kiosk or through Test
Scan, since its last refresh. The client shows a staleness warning past
24h of no refresh but still allows scanning past that point (fail-open by
design — see root `README.md`'s change log for the reasoning and how to
flip it to fail-closed). A kiosk's Supabase session token also still needs
network to refresh (default ~1hr expiry) independent of all of the above —
offline scanning survives an outage, staying signed in through one that
outlasts the token isn't guaranteed unless that's addressed separately
(longer JWT expiry for scanner-only accounts, e.g.).

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
  `upload` accepts an optional `thumb_base64`/`thumb_mime_type` pair
  (added 2026-09-19) — a small (~480px) `.webp` thumbnail the client
  already generated via `Utils/image.js`'s `fileToOfflineThumbWebp()` —
  and, if present and within a sane size bound, returns it straight back
  as `thumb_b64` for the client to store as `employees.photo_thumb_b64`
  (see "Offline scanning" above). Only when the client didn't supply one
  (an older client, or the client-side conversion itself failed) does it
  fall back to fetching a Drive thumbnail **server-side** itself — the
  original mechanism this feature shipped with 2026-09-18, now at
  `sz=w480` (bumped from the original `sz=w96`, which had gone visibly
  blurry once the Scanner started displaying this thumbnail at up to
  `min(82dvh, 82dvw)` — see root `README.md`'s matching change log entry).
  That fallback fetch is bounded to a 2.5s timeout (added 2026-09-19,
  deployed as v33) — it used to run with no timeout at all, which meant a
  freshly-uploaded file without an instantly-ready Drive thumbnail (a
  real, fairly common lag) sat directly in the upload's own response
  time. Either path is best-effort: a failure (fetch timeout, or a
  client-supplied value that fails a basic size/decode sanity check) is
  logged and returns `thumb_b64: null`, never fails the upload itself
  (`url`/`file_id` are already secured by that point regardless).
  When Google itself rejects the stored OAuth credentials the function
  answers **HTTP 503** with a stable `code` (`google_reauth_required` for
  an expired/revoked refresh token, `google_client_invalid` for a bad OAuth
  client) instead of a bare 500 — access tokens renew silently on every
  call, but a dead *refresh* token can only be replaced by a human
  re-consenting once. Causes, prevention, and the 2-minute re-issue steps
  are in `functions/upload-employee-photo/README.md` → "Refresh token stops
  working?".

See `functions/proximity-scan/README.md`, `functions/admin-users/README.md`,
and `functions/upload-employee-photo/README.md` for the request/response
contracts each client-side caller relies on.

---
*Last reconciled against `Supabase:list_tables` (verbose),
`Supabase:list_edge_functions`, `storage.buckets`, and
`pg_get_functiondef()` on the live `kjwttqmbcjvkivgmwuev` project,
2026-09-19. Re-verify against those before trusting this file blindly in a
future session — schema, Storage, and functions evolve independently of
git commits here since nothing is deployed *from* this repo yet.*

### Change log (most recent first)

**2026-09-21 — `upload-employee-photo`: Google auth failures get a stable code; typecheck fix**
- Reported as "Google Drive token expired". Root cause class: Google's
  `invalid_grant` on the **refresh token** (not the access token, which
  already renews itself silently on every call). Previously surfaced as a
  bare 500 carrying Google's raw wording; now a 503 with
  `code: "google_reauth_required"` (or `google_client_invalid`) and an
  actionable message, and the underlying Google error is written to the
  function log (`Google token refresh failed (HTTP 400): invalid_grant — …`)
  so the cause can be confirmed rather than guessed. No client change was
  needed: `EmployeesModel.js`'s upload/delete/quota paths already display
  `body.error` verbatim.
- `concatBytes()`'s explicit `: Uint8Array` return annotation made
  `deno check` fail on Deno/TypeScript 5.7+ (`Uint8Array<ArrayBufferLike>`
  is no longer a valid `fetch()` body). CI's typecheck job runs
  `deno-version: v2.x` (newest 2.x), so this fails the `typecheck` job and
  the dependent `deploy` job never runs — a plausible reason the repo can sit
  ahead of the live function without any visible error. Return type is now
  inferred; no runtime change.
- **Drift as of this entry:** live `upload-employee-photo` was v36
  (2026-09-19 02:37 UTC) and still had the original server-side `sz=w96`
  thumbnail fetch, with no handling of the client-supplied
  `thumb_base64` — i.e. the client sends a ~480px thumbnail that the live
  function ignores. This repo's `index.ts` has the newer behavior. Run
  `Supabase:list_edge_functions` / `get_edge_function` before assuming either
  side is current.
- `README.md` for the function rewritten: request/response contract now
  includes `quota`, the thumbnail fields, the `thumbnail?id=…` URL format
  (it still documented the retired `uc?export=view` URL), and the error-code
  table.

**2026-09-19 — Dropped a redundant, unused RPC (self-correction)**
- `clear_employee_scan_log(p_employee_id)` — a whole-log-nuke function
  added earlier this same session as a first attempt at "let an admin
  delete scan log entries," before discovering the properly-scoped,
  already-deployed `delete_employee_scan_log(p_employee_id, p_scan_id)`
  (per-row delete — see its own entry below) was already live from a
  different session. Nothing in the deployed frontend ever called the
  whole-log version, so it was `DROP FUNCTION`-ed rather than left as
  unused, confusing surface area. See root `README.md`'s matching
  change log entry.
- `get_scanner_offline_cache()`/`classify()` gap (no RPC change): the RPC
  has returned `remarks_log` on every row all along — the client-side
  `classify()` just wasn't passing it through. Pure frontend fix, see
  root `README.md`.

**2026-09-19 — `upload-employee-photo`: prefer a client-supplied `.webp` thumbnail over the server-side Drive fetch**
- No schema change. `upload`'s request body gained optional
  `thumb_base64`/`thumb_mime_type` — see the Edge Function entry above for
  the full contract and root `README.md`'s matching change log entry for
  why (the old `sz=w96` server-side fetch had gone visibly blurry once the
  Scanner started displaying `photo_thumb_b64` at up to
  `min(82dvh, 82dvw)`, and Drive's `/thumbnail` endpoint has no way to
  request `.webp` output specifically, which is why the client generating
  its own thumbnail was the fix rather than just asking Drive for a
  different size).
- The server-side Drive fetch this replaces as the primary path is still
  there as a fallback (now `sz=w480`, not `sz=w96`) for a client that
  didn't supply one.

**2026-09-19 — Split `get_scanner_offline_cache()`'s photo payload into `get_scanner_offline_photos()`**
- New RPC `get_scanner_offline_photos()` — see RPC section above for the
  full contract. `get_scanner_offline_cache()`'s `jsonb_build_object` no
  longer includes `photo_thumb_b64`.
- Backend-only change (this migration, `split_offline_lookup_and_photos`)
  landed same-day as, but separately from, the client-side follow-through
  in root `README.md`'s matching change log entry — flagging that gap
  explicitly here since it's exactly the kind of drift this file warns
  about elsewhere ("the live version can be ahead of this repo"). Always
  `Supabase:list_migrations` before trusting either README's account of
  what's actually deployed.
- Grants double-checked via `has_function_privilege()` rather than
  assumed correct by analogy to the sibling RPCs: `anon` cannot execute,
  `authenticated` can — same as `get_scanner_offline_cache()` and
  `get_scan_feed()`.

**2026-09-19 — `upload-employee-photo`'s thumbnail fetch bounded to a timeout (v33)**
- The only Postgres/Edge Function-side piece of a 3-bug regression report
  after 2026-09-18's `photo_thumb_b64` change — the other two
  (sync-queue slow, Alt-Tab "Loading…") were pure client-side bugs, fully
  detailed in root `README.md`'s matching entry, which also documents a
  deliberately-deferred scaling concern with this RPC's payload shape
  (photos riding along in a frequently-refreshed roster-wide cache) worth
  reading if you're about to touch this area again.
- No schema change. `upload-employee-photo`'s server-side thumbnail fetch
  (see its Edge Function entry above) now carries a 2.5s
  `AbortSignal.timeout()` — it previously had none at all, so a
  freshly-uploaded file's thumbnail not being instantly ready on Drive's
  side (a real, fairly common few-second lag) sat directly in the
  upload's own response time, reported directly as "upload speed slow."

**2026-09-18 — `employees.photo_thumb_b64`: replaced Drive-prefetch with a stored server-side thumbnail**
- New column `employees.photo_thumb_b64` (text) — a small base64 JPEG,
  written by `upload-employee-photo`'s `upload` action right after every
  successful upload (see its Edge Function entry above).
- `get_scanner_offline_cache()` and `get_scan_feed()` (`CREATE OR REPLACE`,
  same signatures as before — no overload risk this time, unlike the
  2026-09-16 `scan_proximity_code()` mistake) both now return it.
- **Why:** the previous approach — a roster-wide client-side prefetch of
  every employee's Drive thumbnail into a Service Worker cache — fetched
  each one with `{mode:'no-cors'}` (required, since Drive's `/thumbnail`
  endpoint sends no CORS headers for a page-script `fetch()`). A `no-cors`
  response is always "opaque" (`status: 0`, `ok: false`) **whether or not
  the request actually succeeded** — there is no way to tell a real
  failure apart from success. Across 700+ concurrent-ish requests, that
  meant some fraction silently "succeeded" as empty/failed cache entries
  on every single prefetch pass, with no error, no pattern, and no way to
  detect it client-side. Fetching the same thumbnail **server-side**
  instead (a normal fetch from Deno to Google, no CORS involved at all)
  makes `res.ok` a real, trustworthy signal — a failure there is a real,
  loggable failure, not indistinguishable from success.
- `get_advisors` (security) re-run after both `CREATE OR REPLACE`s —
  clean, same 3 pre-existing `anon`-executable findings as before
  (`can_manage_scan_sounds`, `can_view_settings`, `rls_auto_enable` — none
  from this work), confirmed via `has_function_privilege()` that neither
  changed function is `anon`-executable.
- Full client-side detail (deleted `prefetchPhotos()`, `sw.js`'s
  `PHOTO_CACHE`, the live-retry-fetch; new `offlineAvatarHTML()`) in root
  `README.md`'s matching change log entry.

**2026-09-17 — Fixed a real concurrency bug in `trg_append_scan_log()`, plus one more offline-photo gap**
- **Root cause of the IN/OUT/OUT/IN corruption seen in Employee Manager's
  scan log** (reported with screenshots — two employees' logs showing
  broken alternation): `trg_append_scan_log()` used to `SELECT
  jsonb_array_length(scan_logs)`, compute `direction`, THEN run a separate
  `UPDATE` — two statements with no row lock between them. Two
  `scan_events` inserts for the same employee landing close together (a
  live kiosk scan racing an offline-queue replay, in particular, though
  any two near-simultaneous scans could trigger it) could both `SELECT`
  the same stale count and both compute the same direction before either
  `UPDATE` committed. Fixed by moving `jsonb_array_length(scan_logs)`
  *inside* the `UPDATE`'s `SET` clause — Postgres locks the target row for
  the duration of an `UPDATE`, so a second concurrent `UPDATE` for the
  same employee now blocks until the first commits, then evaluates
  `scan_logs` fresh against the just-updated row. Single atomic statement,
  same guarantee `add_employee_remark()` already relies on.
- `scan_proximity_code()` no longer computes its own `direction` via a
  second, independent `SELECT` before the insert (which could itself
  still drift from the trigger's answer under concurrency, even after the
  fix above) — it now reads the trigger's own just-written value back
  (`scan_logs -> -1 ->> 'direction'`) after the insert, since
  `trg_scan_events_append_log` fires synchronously (`AFTER INSERT`, same
  transaction) before the function continues. Single source of truth, no
  duplicate logic, provably matches what's actually stored.
- Each `scan_logs` entry now also carries `'offline'` (from
  `scan_events.raw_payload->>'captured_offline'`) — lets
  `JS/Components/ScanLogModal.js` show *why* a backdated entry might sit
  at a position that looks out of chronological order (see its own entry
  in root `README.md`'s change log: insertion order and `scanned_at` order
  can legitimately differ once offline-synced scans exist, and the modal
  now displays true insertion order rather than re-sorting by time, which
  would visually "un-alternate" an otherwise-correct sequence).
- **One-time data repair**, disclosed here rather than done silently:
  ran a migration recomputing `direction` for all 14 employees who had
  any `scan_logs` history, purely from array position parity (1st scan
  ever = in, 2nd = out, ... — fully deterministic, so this is a lossless
  correction of bad values the bug above had written, not a reinterpretation
  of history). No other field touched.
- Also closed one more offline-photo gap on the client side: `classify()`
  is purely local and never itself attempts a network request, so a photo
  the background prefetch (see 2026-09-17 entries above) hadn't reached
  yet for a given employee fell straight to the default avatar — even in
  the common case where "offline" actually means Supabase specifically
  failed while the general connection (and Drive) is still fine. See
  root `README.md`'s change log for the client-side fix
  (`Utils/format.js`, `Scanner/StandaloneScanner.js`).

**2026-09-17 — Offline scanner client-side bug fixes (no schema/RPC change)**
- No Postgres changes — `get_scanner_offline_cache()` already returned
  `photo_url`/`updated_at`; `JS/Models/OfflineScanModel.js#classify()` just
  wasn't passing them through to the rendered result, which is why offline
  scans showed initials instead of the employee photo. See root
  `README.md`'s change log for the full list of client-side fixes
  (resync-on-reconnect, Recent Activity not updating post-sync, and
  scan-sound loading never retrying after a failed first attempt).

**2026-09-16 — Offline scanning: `get_scanner_offline_cache()` + backdated `scan_proximity_code()`**
- `scan_proximity_code()` gained two optional, backward-compatible params:
  `p_scanned_at` (default `now()`) so a scan replayed from the offline
  queue keeps its true original time, and `p_offline` (default `false`)
  to tag the row's `raw_payload` for audit visibility. See "Offline
  scanning" above for the full picture, including the client side.
- New `get_scanner_offline_cache()` RPC — trimmed card/employee projection
  for the client's local IndexedDB cache.
- **Self-caught bug, worth recording so it's recognizable if it recurs:**
  the first attempt at the `scan_proximity_code()` change used
  `CREATE OR REPLACE FUNCTION` with new parameters added — Postgres
  matches `CREATE OR REPLACE` by argument *types*, so a changed signature
  creates a **new, separate overload** rather than replacing the old one.
  This left the original 2-arg function orphaned alongside the new 4-arg
  one, and — because this project grants `EXECUTE` to `PUBLIC` by default
  on newly `CREATE`d functions, unlike the explicit per-function grants
  everything else here relies on — the new overload was briefly callable
  by `anon` (unauthenticated) via PostgREST. Caught via `get_advisors`
  (security) before this was ever exposed to real traffic; fixed by
  `DROP FUNCTION`-ing the orphaned 2-arg overload and explicitly
  `REVOKE`-ing `public`/`anon` + `GRANT`-ing `authenticated` on both new
  functions, then confirmed clean via `has_function_privilege()`.

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