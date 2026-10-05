# Supabase Exit / Continuity Runbook

## Deadline

**Target: migrate the Proximity production dependency before 03 Nov 2026.**

Do not wait for the restriction to occur. Treat 2026-10-20 as the internal cutover target and keep the remaining time as rollback/verification buffer.

Supabase currently documents that Fair Use restrictions can make project APIs return HTTP 402, and Free projects are also subject to pausing. The exact restriction mechanism for this account should be confirmed from the billing/usage notices, but the architecture should not depend on continued hosted Supabase availability.

## Immediate objective

Preserve the current application and data first. Architecture cleanup comes second.

The emergency target is:

```
Current Supabase PostgreSQL
        |
        | backup / export
        v
Local PostgreSQL 17
        |
        +--> local application/API
        |
        +--> independent backup
```

Then move toward:

```
Site PostgreSQL -> Sync API -> Central PostgreSQL
```

## Priority order

### P0 — protect data

Before changing production:

- Export the PostgreSQL database.
- Export Supabase Storage objects.
- Export Auth/user configuration and identify secrets/configuration that must be recreated.
- Save the current Supabase project URL/ref.
- Save the current migration files from GitHub.
- Record enabled extensions, functions, triggers, publications, storage buckets and RLS policies.
- Make at least one restore test against a local PostgreSQL 17 instance.

**Do not assume the GitHub migration folder alone is a complete backup.** The repository documents known cases of live Supabase state being ahead of GitHub.

### P0 — create a local PostgreSQL 17 environment

Use PostgreSQL 17 locally.

Do not change the schema to MySQL during the emergency migration.

The immediate success condition is:

> The local PostgreSQL database can answer the application's existing business queries and RPC-equivalent logic.

### P1 — keep the current frontend alive

Do not rewrite the frontend before the data is safe.

First introduce a compatibility layer so existing models can transition from:

```
supabase.from()
supabase.rpc()
supabase.auth()
supabase.storage()
```

to:

```
Local API
```

Migrate one capability at a time.

### P1 — scanner continuity

The scanner is the most important offline path.

Keep:

- IndexedDB lookup cache
- offline scan queue
- original scan timestamps
- queued-scan replay
- local photo/sound cache

The scanner must be able to operate with no Internet.

### P2 — local API

Introduce a local API:

```
Browser -> Local API -> PostgreSQL
```

The browser must not receive PostgreSQL credentials.

### P2 — synchronization

Add:

```
sync_outbox
sync_inbox / processed_changes
site_id
change_id
version
tombstones
```

Start with append-only `scan_events`.

### P3 — remove remaining Supabase dependencies

After local operation is proven:

- Auth
- Realtime
- Storage
- Edge Functions
- PostgREST
- Supabase client

can be replaced or self-hosted.

## What NOT to do before the deadline

- Do not migrate PostgreSQL to MySQL.
- Do not rewrite the entire frontend.
- Do not put PostgreSQL credentials in browser JavaScript.
- Do not create a separate unsynchronized database for every workstation.
- Do not rely on browser IndexedDB as the only permanent database.
- Do not implement multi-master conflict resolution as an afterthought.
- Do not delete the Supabase project until a local restore has been verified.

## Cutover strategy

### Stage A — shadow local database

Run local PostgreSQL while Supabase remains production.

Copy production data periodically.

### Stage B — local API in test mode

Run the application against local PostgreSQL without changing the production system.

Test:

- login
- employee CRUD
- proximity cards
- scanner
- attendance
- dashboard
- alerts
- audit
- exports
- settings
- photo handling

### Stage C — local production pilot

Choose one site/device group.

Operate locally for several days while keeping Supabase available as rollback/reference.

### Stage D — synchronization

Verify:

- offline scan
- reconnect
- duplicate retry
- two-site scan
- deletion
- employee edit
- conflict detection
- backup/restore

### Stage E — production cutover

Freeze writes briefly.

Perform final data export.

Restore/verify the final local database.

Switch the application to the local API.

Keep the original Supabase data untouched until the new system has passed the agreed retention period.

## Rollback

Rollback must be possible by changing the application endpoint back to the old service.

Do not destroy the old Supabase environment immediately after cutover.

## Final architecture

```
                  CENTRAL
              PostgreSQL
                   ^
                   |
                Sync API
                   ^
                   |
        Internet / VPN when available
                   |
        +----------+----------+
        |                     |
     SITE A                 SITE B
        |                     |
   Local API             Local API
        |                     |
 PostgreSQL             PostgreSQL
        ^                     ^
        |                     |
       LAN                   LAN
        |                     |
   Clients/scanners       Clients/scanners
```

This architecture makes Internet connectivity an **integration dependency**, not a **basic operational dependency**.

## Definition of done

- [ ] Full production database backup exists.
- [ ] Storage objects are backed up.
- [ ] Local PostgreSQL restore has been tested.
- [ ] Local application works without Supabase.
- [ ] Scanner works without Internet.
- [ ] Multiple local clients share one site database.
- [ ] Scan events synchronize without duplicates.
- [ ] Deletions cannot resurrect.
- [ ] Master-data conflicts are visible.
- [ ] Local backups are automated.
- [ ] Rollback has been tested.
- [ ] Supabase can be retired without losing data.
