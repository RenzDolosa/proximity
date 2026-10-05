# Local database (Phase 0 tooling)

Supporting files for `docs/LOCAL_DATABASE_ARCHITECTURE.md`. Phase 0 only:
making `Supabase/migrations/` able to build a working database from empty.
Nothing here runs a site stack or syncs anything.

## Run it

```bash
supabase start                      # Supabase CLI local stack
./Supabase/local/apply-migrations.sh
```

Or against any other database:

```bash
./Supabase/local/apply-migrations.sh "postgresql://user:pass@host:5432/db"
```

## Expect this to fail today

It stops at `20261002000000_scanner_silence_alerts.sql`, which calls
`public.raise_alert()` and reads `public.scanners` / `public.alerts` — none of
which any migration in this repo creates. That failure is the point: it is the
blocker Phase 0 exists to clear, not a problem with the script.

`test/schema-drift.test.mjs` pins the same gap in CI, so it can't widen while
it's being paid down.

## Why the Supabase CLI and not a bare `postgres:17`

The committed schema depends on platform surface a vanilla image doesn't have:
the `anon`/`authenticated`/`service_role` roles, the `auth` schema behind
`auth.uid()` and the `trg_on_auth_user_created` trigger on `auth.users`,
`storage.buckets`/`storage.objects` for the scan-sounds bucket, and
`pg_cron`/`pg_stat_statements`. Writing a compatibility shim for all of that is
real work, and doing it in the same phase as fixing the migrations means you
can't tell which layer a failure came from. Validate the migrations first.

## Also here: `export-project.sh`

Captures a complete, restorable copy of the live Supabase project — schema,
data, `auth.users`, roles, extensions, every function definition, RLS policies,
triggers, live migration history, cron jobs, realtime publication, storage
bucket config and object listings, plus row counts for restore verification.
Read-only against the project.

```bash
./Supabase/local/export-project.sh "postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
```

Direct connection (port 5432, **not** the 6543 pooler), and PostgreSQL client
tools **17+** — an older `pg_dump` refuses to dump a 17 server.

It writes a `MANIFEST.md` listing what it could *not* capture (storage object
bytes, Edge Function source, secrets, auth provider config). Read it.

See `docs/SUPABASE_QUOTA_DECISION.md` for when and why to run this, and why its
`inventory/public-functions.sql` output is also the raw material for closing
the Phase 0 schema drift above.

## Moving the database to a local PostgreSQL (Windows)

`Migrate-Local.ps1` is the PowerShell end-to-end path: preflight, read-only
export from Supabase, role bootstrap, restore, and a row-count verification
that fails loudly rather than reporting a partial copy as a success.

```powershell
winget install -e --id PostgreSQL.PostgreSQL.17   # then reopen PowerShell
$env:SUPABASE_DB_URL = 'postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
.\Supabase\local\Migrate-Local.ps1
```

Setting `$env:SUPABASE_DB_URL` rather than passing `-SourceUrl` keeps the
password out of PowerShell history. Stage 2 is read-only against Supabase —
`pg_dump` issues no DDL or DML.

### `bootstrap-roles.sql`

Run automatically by stage 3, and usable on its own. A Supabase `pg_dump`
carries GRANTs and RLS policies naming roles the dump itself cannot include —
roles are cluster-level, so they fall outside a per-database dump. Restoring
without them yields `role "anon" does not exist` and a database whose RLS is
silently incomplete, which for an access-control system is the worst failure
mode available: it restores "successfully" and enforces nothing.

It also creates the extensions stock PostgreSQL 17 actually ships. It
deliberately does **not** create `pg_cron`, `pg_graphql`, `pgjwt` or
`supabase_vault` — those are packaged separately or Supabase-specific, and
`pg_restore` logging errors for them is expected. Any *other* restore error is
not; the script separates the two and surfaces the unexpected ones.

### What this does and does not get you

A database copy. **Not** a working local app. The browser still depends on
Supabase for RLS as the permission boundary, Auth, Realtime, Storage and Edge
Functions — see `docs/SUPABASE_EXIT_RUNBOOK.md` for the staged cutover and
`docs/LOCAL_DATABASE_ARCHITECTURE.md` §2 for the schema gaps you will hit.
`pg_cron` jobs (archival, scan-log trim, scanner silence) do not come across.
