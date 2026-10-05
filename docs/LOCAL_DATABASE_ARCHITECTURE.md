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
