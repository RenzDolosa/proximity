# Local Database + Cross-Site Sync Architecture

## Decision

Do not migrate this project from Supabase/PostgreSQL to MySQL.

The current application is deeply coupled to PostgreSQL semantics: RLS, SQL functions/RPCs, triggers, JSONB, UUIDs, Realtime, Auth, Storage, and Edge Functions. A MySQL migration would become a backend rewrite.

Recommended target:

> Local PostgreSQL at each physical site + local application/API + durable synchronization to a central PostgreSQL server.

The central server does not have to be Supabase. It can eventually be self-managed PostgreSQL on a VPS or dedicated server.

## What the repository already has

The Scanner already has an important local-first foundation:

- IndexedDB lookup cache.
- Offline scan queue and replay.
- Per-employee replay ordering.
- Incremental lookup synchronization.
- Incremental employee-photo synchronization.
- Append-oriented scan_events, which is much easier to synchronize than mutable master data.

Therefore, the project does not need to be redesigned from zero for offline operation.

## Current Supabase coupling

The browser currently depends on Supabase for:

1. PostgreSQL access through PostgREST.
2. PostgreSQL RPC functions.
3. Row Level Security.
4. Authentication and sessions.
5. Realtime subscriptions.
6. Storage for scan sounds.
7. Edge Functions for privileged operations and employee-photo handling.

A database-only replacement will not work. The correct architectural boundary is a local API between the browser and PostgreSQL.

## Target architecture

    Browser
       |
       | LAN / HTTPS
       v
    Local Proximity API
       |
       +---- Local PostgreSQL
       +---- Local file/object storage
       +---- Sync worker
                 |
                 | HTTPS
                 v
           Central Sync API
                 |
                 v
           Central PostgreSQL

The browser should never connect directly to PostgreSQL.

## Local deployment

### Preferred: one local server per physical site

All scanners, PCs and tablets at the same site connect to one local Proximity server over the LAN.

    Clients -> LAN -> Local Proximity Server -> Local PostgreSQL

This gives immediate local consistency and normal operation without Internet.

When Internet returns:

    Local PostgreSQL -> Sync Worker -> Central Sync API -> Central PostgreSQL

### Do not start with one database per workstation

That becomes multi-master synchronization. Two disconnected workstations can edit the same employee or card and both changes may appear valid.

PostgreSQL logical replication can replicate changes, but conflicts can stop replication and require manual resolution. It is not a complete application-level conflict strategy.

## Synchronization model

Use an explicit synchronization layer.

### Globally unique IDs

Use UUIDs for employees, cards, scan events, alerts, audit records and synchronization records.

### Site identity

Every local installation gets a stable site_id.

Example labels:

    MANILA-01
    WAREHOUSE-02
    OFFICE-03

Human-readable labels should be separate from the internal UUID.

### Durable sync outbox

Every local mutation that must reach the central system creates an outbox record containing:

    id
    site_id
    entity_type
    entity_id
    operation
    payload
    created_at
    attempts
    synced_at
    last_error

The business change and its outbox row must be committed in the same database transaction.

Bad:

    UPDATE employees;
    INSERT sync_outbox;

Good:

    BEGIN;
    UPDATE employees ...;
    INSERT sync_outbox ...;
    COMMIT;

This prevents a crash between the business write and synchronization record from creating silent divergence.

### Idempotent central writes

Every synchronization message gets a unique change/event ID. The central server records processed IDs.

If a site retries a message after losing the network immediately after a successful central commit, the central server recognizes the duplicate and returns success instead of inserting the data twice.

### Deletions use tombstones

Do not immediately hard-delete synchronized records. Use deleted_at/deleted_by or a dedicated deletion record so an offline site cannot resurrect a deleted record simply because it never received the deletion.

## Scan events

scan_events should be treated as an append-only event stream.

Each event should carry a global UUID, site_id, scanner_id, employee/card IDs, scanned_at, result and an offline indicator where useful.

Synchronization rule:

> If the event UUID already exists, ignore the duplicate. Otherwise insert it.

Do not use last-write-wins for scan events. An offline scan is still a real event.

## Employees and proximity cards

These are mutable master records and require explicit conflict rules.

Recommended first policy:

- Central system is authoritative for employee/card master data.
- Local sites may create or edit records while offline only where the workflow requires it.
- Mutations carry site_id, updated_at, updated_by and a version.
- Conflicts are detected and recorded for administrative resolution.

Do not begin with automatic field-level merging. It is harder to audit and easier to get subtly wrong.

## Authentication and authorization

The current Supabase RLS model is a major security boundary. In a pure local-API architecture, move that boundary to the API and server-side database transactions.

Keep the existing permission model:

- admin
- manager
- viewer
- access_scope: all, employee_manager, scanner

The browser should only control presentation. It must not be trusted to enforce authorization.

## Realtime

Supabase Realtime should eventually be replaced by a local WebSocket or SSE channel from the Proximity API.

Database synchronization and UI realtime notifications are separate concerns. The sync protocol should not be responsible for repainting browser screens.

## File storage

Employee photos and scan sounds can eventually move to local file/object storage controlled by the API.

For synchronized photos, use stable file IDs and content hashes so unchanged files are not retransferred.

## Migration phases

### Phase 1 — make the database portable

- Reconcile migration history.
- Make the migration folder authoritative.
- Reconcile live-only changes.
- Verify functions, triggers, indexes and constraints.
- Add database integration tests.

The repository currently documents migration-history drift between GitHub and the live Supabase project, so this must be resolved before treating the migration folder as a complete source of truth.

### Phase 2 — local PostgreSQL compatibility environment

Run PostgreSQL locally and restore the existing schema. Keep production Supabase untouched.

This gives the project a repeatable local database for integration testing before the application is disconnected from Supabase.

### Phase 3 — introduce the local API boundary

Refactor browser models so they call an API instead of supabase.from() and supabase.rpc().

Move existing RPC business rules into server-side transactions/services where practical. Do not duplicate business rules in the browser and server.

### Phase 4 — local-first site operation

Deploy Local API + Local PostgreSQL + local file storage + sync worker.

The existing IndexedDB scanner queue remains useful as the device-level resilience layer.

### Phase 5 — central synchronization

Start synchronization with scan events because they are append-only and low-risk. Then synchronize employee master data, cards, alerts, audit records and finally user/admin data.

### Phase 6 — remove managed Supabase dependencies

Only after the local architecture is stable should the project remove Supabase Auth, PostgREST/browser database access, Realtime, Storage and Edge Functions.

PostgreSQL remains.

## Transitional option: self-hosted Supabase

There is a faster intermediate architecture: self-host Supabase locally with Docker.

This preserves PostgreSQL, Auth, REST, Realtime, Storage and Edge Functions while moving the infrastructure under your control. It minimizes immediate application changes.

However, self-hosted Supabase is still Supabase. It is best treated as a transition or a deliberate self-hosted platform choice, not as the final pure-PostgreSQL/API architecture.

Recommended sequence:

    Managed Supabase
          |
          v
    Self-hosted Supabase + local PostgreSQL
          |
          v
    Local API + PostgreSQL
          |
          v
    Local PostgreSQL + central PostgreSQL sync

Do not attempt all four migrations at once.

## Success criteria

- [ ] A site operates normally with Internet disconnected.
- [ ] Multiple local clients see the same local data over LAN.
- [ ] Offline scans preserve their original timestamps.
- [ ] Reconnection does not duplicate scans.
- [ ] Two sites can operate offline simultaneously.
- [ ] Both sites synchronize after reconnection.
- [ ] Deletions cannot resurrect.
- [ ] Employee/card conflicts are detected and auditable.
- [ ] API authorization cannot be bypassed by direct browser requests.
- [ ] Local realtime dashboard updates still work.
- [ ] Employee photos work offline.
- [ ] Failed sync can be retried safely.
- [ ] A complete local-site backup can be restored.

## Architecture conclusion

The important decision is not simply Supabase versus local database.

> The real design problem is deciding where authoritative state lives and how disconnected installations exchange durable changes without losing or duplicating data.

Once that synchronization contract is correct, PostgreSQL can run locally, centrally, or both without forcing another rewrite of the core business data model.

# Local database with cross-site sync — architecture

**Status:** proposal. Nothing in this document is implemented. Branch
`architecture/local-database-sync`; deliberately not merged to `main`.
**Last updated:** 2026-10-05.

The goal: each physical site keeps working with no Internet, every device at
a site shares data immediately, and all sites converge on a central database
when connectivity returns.

---

## 1. Verdict

Yes, this is achievable, and the project is already further toward it than it
looks. But the first step is **not** the sync engine, and it is not moving off
PostgreSQL.

- **Keep PostgreSQL.** The live project is PostgreSQL 17 and the application
  leans on Postgres-specific behaviour throughout: RLS policies as the actual
  permission boundary, `SECURITY DEFINER` functions, triggers
  (`trg_append_scan_log` derives IN/OUT direction at insert time), `jsonb`
  columns (`scan_logs`, `remarks_log`), views, `pg_cron`, `pg_stat_statements`.
  A move to MySQL would be a backend rewrite bought for nothing — the thing
  you want is *local*, not *a different engine*.
- **One database per site, not per device.** Per-device databases turn every
  pair of machines into a multi-master conflict. One local PostgreSQL per
  physical location, with LAN clients sharing it, keeps conflicts to the
  (much rarer, much more tractable) site-to-site case.
- **Don't start with sync.** Start by making `Supabase/migrations/` able to
  build a working database from empty. It currently cannot — see §2, which is
  the single most important finding in this document.

```
                              CENTRAL
                     ┌───────────────────────┐
                     │ PostgreSQL            │
                     │ Sync API              │
                     │ Cross-site reporting  │
                     └───────────▲───────────┘
                                 │  Internet / VPN
                  ┌──────────────┴──────────────┐
                  │                             │
          ┌───────┴────────┐            ┌───────┴────────┐
          │ SITE A         │            │ SITE B         │
          │ Proximity API  │            │ Proximity API  │
          │ PostgreSQL     │            │ PostgreSQL     │
          │ Sync worker    │            │ Sync worker    │
          └───────▲────────┘            └───────▲────────┘
                  │ LAN                         │ LAN
          ┌───────┴────────┐            ┌───────┴────────┐
          │ Scanners, PCs  │            │ Scanners, PCs  │
          └────────────────┘            └────────────────┘
```

---

## 2. The blocker: the repo cannot build its own database

Every phase below starts with "stand up the schema from
`Supabase/migrations/`". Verified on 2026-10-05, that does not work.

**Applying these migrations in order to an empty PostgreSQL fails outright.**
`20261002000000_scanner_silence_alerts.sql` calls `public.raise_alert()` and
reads and writes `public.scanners` and `public.alerts`. No migration in this
repository creates any of those three.

**Nine RPCs the client calls have no source anywhere in the repo:**

| RPC | Called from |
|---|---|
| `get_dashboard_stats` | `Models/DashboardModel.js` (fallback path) |
| `get_onsite_roster` | `Models/DashboardModel.js` |
| `get_alerts` | `Models/AlertsModel.js` |
| `get_unread_alert_count` | `Models/AlertsModel.js`, `Core/alertsBadge.js` |
| `acknowledge_alert` | `Models/AlertsModel.js` |
| `acknowledge_all_alerts` | `Models/AlertsModel.js` |
| `get_scanners` | `Models/ScannersModel.js` |
| `update_scanner` | `Models/ScannersModel.js` |
| `get_scanner_performance_stats` | `Models/ScannerStatsModel.js` |

Plus `raise_alert()`, called by a committed migration.

The committed baseline is also **stale, not merely incomplete**:
`Supabase/README.md` records that a `scanners` row is created by
`scan_proximity_code()`'s own upsert, but the `scan_proximity_code()` in
`20260922072224_production_schema_baseline.sql` contains no reference to
`scanners` at all. So the baseline is an older version of a function that has
since changed live.

This is all consistent with what the repo already documents about itself.
`.github/AI_REVIEW.md` says schema and RLS changes applied directly to the
project (for example via MCP) bypass the review pipeline entirely, and
`Supabase/README.md`'s change log records the same "backend shipped, no
migration file" pattern four separate times. The AI review only ever sees a
PR diff — it structurally cannot catch a function that was never committed.

**This is now enforced, not just documented.** `test/schema-drift.test.mjs`
compares every RPC called from `JS/` and every object referenced by a
migration against what the migrations actually create. The drift above is
pinned in an explicit allowlist so `npm test` stays green while it's paid
down; anything *new* fails CI immediately, and reconciling an object forces
its allowlist entry to be deleted.

---

## 3. Phases

Ordered so that each phase is independently valuable and independently
revertible. No phase requires the next one to have been started.

### Phase 0 — make the schema authoritative *(start here)*

Nothing else is safe until this is true. Success criterion: a brand-new
database built only from this repo passes the same integration checks as
production.

1. Pull the nine missing functions, `raise_alert()`, and the `alerts` and
   `scanners` tables out of the live project (`pg_get_functiondef`,
   `supabase db pull`) and commit them as migrations.
2. Reconcile the current `scan_proximity_code()` — the committed baseline is
   behind live.
3. Reconcile `supabase_migrations.schema_migrations`, which
   `Supabase/README.md` records as not containing several files that are
   nonetheless live, with repo filenames using different version numbers than
   the live history. Until this is done, `supabase db push` would try to
   re-run migrations that already took effect.
4. Verify with `Supabase/local/apply-migrations.sh` against a `supabase start`
   stack, then write the RPC/RLS integration suite `.github/AI_REVIEW.md`
   already names as missing — in particular the permission matrix, since RLS
   is the real security boundary and nothing currently tests it against a
   real database.
5. Delete allowlist entries in `test/schema-drift.test.mjs` as each lands.

**Use the Supabase CLI stack for this phase, not a bare `postgres:17`
container.** The schema depends on platform surface a vanilla image doesn't
have: the `anon`/`authenticated`/`service_role` roles, the `auth` schema
behind `auth.uid()` and the `trg_on_auth_user_created` trigger on
`auth.users`, `storage.buckets`/`storage.objects` for the scan-sounds bucket,
and `pg_cron`/`pg_stat_statements`. Replacing that surface is real work;
mixing it into Phase 0 means you can't tell a migration bug from a
compatibility-shim bug. Validate the migrations first, replace the platform
later, and only if you still want to.

### Phase 1 — run a site stack

Self-host the stack per site so the site survives an Internet outage. The
browser keeps talking to the same API surface it does today. Central is still
the source of truth; sites are read-mostly replicas plus local scan capture.

### Phase 2 — the local API

The architectural change with the most consequence: stop letting the browser
reach the database directly.

```
Browser → Local API → PostgreSQL
```

The API becomes the security boundary that RLS plus `SECURITY DEFINER` RPCs
occupy today. Migrate one feature at a time, Scanner first (it has the
clearest contract and the best offline story already), then Employees/Cards,
then Dashboard/Attendance/Alerts/Audit.

**Be explicit about what this costs.** RLS is enforced by the database for
every caller, on every query, whatever the bug. An application-layer boundary
is enforced only where someone remembered to enforce it. Moving the boundary
up is a real downgrade in defence-in-depth, and it should be a deliberate
trade for offline autonomy, not a side effect of changing transport. Mitigate
by keeping RLS enabled underneath and having the API connect as a role that is
still subject to it.

### Phase 3 — sync

Only now. See §4.

---

## 4. Sync design

### Outbox, written in the same transaction

```sql
BEGIN;
  UPDATE employees SET department = 'Operations' WHERE id = '...';
  INSERT INTO sync_outbox (...);   -- same transaction, not a second step
COMMIT;
```

A crash between the write and the outbox row is a change that exists locally
and can never reach central — silent, permanent divergence that no retry
fixes because nothing knows it's owed.

### Scan events: append-only and idempotent

`scan_events` is already the right shape. Each row carries a client-generated
UUID and a `site_id`; central inserts on first sight and ignores a duplicate
`event_id`.

Idempotency must key on the event id, never on "did the request succeed" — a
network failure after the server commits but before the response arrives is
indistinguishable from a failure before it. This is the same reasoning behind
the existing IndexedDB replay queue, which already preserves per-employee
ordering because direction is derived server-side from scan parity.

### Master data: surface conflicts, don't resolve them silently

Last-write-wins quietly destroys a real edit. For an access-control system,
two sites editing the same employee offline should produce an explicit
conflict record an administrator resolves.

### Deletions: tombstones, never hard deletes

A hard delete plus an offline peer resurrects the row on reconnect — a deleted
employee's card working again is a security failure, not a data-quality one.
Use `deleted_at`/`deleted_by` and sync the tombstone.

### Keep IndexedDB

The existing browser-side offline layer stays. It covers a case the site
server cannot: the LAN or the site server itself being unavailable.

```
Browser ──┬── IndexedDB queue (server unreachable)
          └── Local API → PostgreSQL (normal)
```

---

## 5. Technology

| Component | Recommendation | Note |
|---|---|---|
| Local + central DB | PostgreSQL 17 | match live; no engine change |
| Browser | current plain-ES-modules app | no build step today — keep it |
| Device offline cache | IndexedDB | already built; keep |
| Local API | Node.js / TypeScript | frontend is already JS; PHP viable if XAMPP is a hard constraint |
| Local realtime | WebSocket or SSE | replaces Supabase Realtime |
| Sync | application-level outbox/inbox | not logical replication — see below |
| IDs | UUID | already used throughout |
| Supabase | transitional, or keep as central | see §6 |

**Why not PostgreSQL logical replication for sync?** It gives you no conflict
model. It is excellent for one-writer-many-readers and wrong for sites that
must accept writes while partitioned. The outbox is more code and the right
shape.

---

## 6. What to do about Supabase

Three honest options:

- **A — keep it.** Lowest cost. You remain Internet-dependent for the primary
  database. If outages are rare and short, this is a legitimate answer.
- **B — self-host it.** Preserves Auth, PostgREST, RLS, Realtime, Storage and
  Edge Functions while moving infrastructure under your control. Best
  value-per-risk, and the natural Phase 1.
- **C — local API + PostgreSQL, Supabase as central or gone.** The endpoint
  of this document. Most control, most work, and it means owning auth,
  authorization, storage and realtime yourself.

B is the recommended transitional target. C is only worth it if sites must
accept writes while partitioned — which is the actual requirement here, so C
is likely right eventually. Decide after Phase 0, when you have a schema you
can trust and real measurements of how often sites are offline.

---

## 7. Open questions

These change the design and should be answered before Phase 1:

1. **How many sites, and how many devices per site?** One site means most of
   this is unnecessary — self-hosting (option B) would be the whole answer.
2. **How long are real outages?** Minutes argues for A or B; hours or days
   justifies C.
3. **Must an employee badge in at Site A and out at Site B?** If yes,
   cross-site IN/OUT parity is a hard distributed problem, because direction
   is currently derived from a single counter (`scan_parity_count`) that two
   partitioned sites would both increment independently. This is the single
   biggest open risk in the whole plan and nothing above solves it.
4. **Is central authoritative for employees and cards?** Strongly recommended
   — it reduces §4's conflict case to almost nothing.
5. **Where do employee photos live?** They are Google Drive today; offline
   sites need a local story.

---

## 8. Related

- `test/schema-drift.test.mjs` — enforces §2
- `Supabase/local/apply-migrations.sh` — Phase 0 tooling
- `Supabase/README.md` — schema, RPC contracts, drift change log
- `.github/AI_REVIEW.md` — why schema applied outside a PR isn't reviewed
