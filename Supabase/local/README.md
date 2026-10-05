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
