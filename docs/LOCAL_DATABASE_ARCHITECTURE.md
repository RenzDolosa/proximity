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
