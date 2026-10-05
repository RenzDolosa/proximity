#!/usr/bin/env bash
# Captures a complete, restorable copy of the live Supabase project.
#
# This is the P0 for the 03 Nov 2026 quota deadline (see
# docs/SUPABASE_EXIT_RUNBOOK.md). It is worth running TODAY whichever option
# you end up taking — getting back under quota, upgrading the plan, or leaving
# Supabase — because it costs nothing, changes nothing on the live project, and
# is the only one of the three that is irreversible if you skip it.
#
# It also does double duty. `pg_dump --schema-only` captures every live
# function, table, policy and trigger — including the nine RPCs and the
# `alerts`/`scanners` tables that test/schema-drift.test.mjs currently has
# allowlisted as missing from Supabase/migrations/. So this same run is the
# raw material for the Phase 0 schema reconciliation in
# docs/LOCAL_DATABASE_ARCHITECTURE.md. Capture once, use for both.
#
# Usage:
#   ./Supabase/local/export-project.sh "postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
#   ./Supabase/local/export-project.sh "$DB_URL" ./backups/2026-10-05
#
# Get the connection string from: Supabase dashboard > Project Settings >
# Database > Connection string > URI. Use the DIRECT connection (port 5432),
# not the pooler (6543) — pg_dump needs session-level features the transaction
# pooler does not provide.
#
# Requires: pg_dump and psql from PostgreSQL client tools **17 or newer**. A
# client older than the server refuses to dump ("server version mismatch"),
# which is the single most common failure here.
#
# This script is read-only against the project. It issues no DDL, no DML, and
# no configuration change.
set -uo pipefail

DB_URL="${1:-}"
OUT="${2:-./supabase-export-$(date +%Y%m%d-%H%M%S)}"

if [ -z "$DB_URL" ]; then
  echo "usage: $0 <postgresql://...> [output-dir]" >&2
  exit 2
fi

for tool in pg_dump psql; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not on PATH" >&2; exit 2; }
done

mkdir -p "$OUT"/{schema,data,inventory,storage,functions}
echo "Exporting to $OUT"
echo

failures=0
# Soft-fail wrapper: one unreadable schema (cron and vault in particular are
# often restricted) must not abandon the rest of the capture. Anything that
# fails is reported in the summary rather than silently skipped — a backup you
# believe is complete but isn't is worse than no backup.
step() {
  local label="$1"; shift
  printf '==> %s\n' "$label"
  if "$@"; then
    return 0
  fi
  printf '    FAILED: %s\n' "$label" >&2
  failures=$((failures + 1))
  return 0
}

q() { psql "$DB_URL" -At -c "$1"; }
csv() { psql "$DB_URL" -c "\\copy ($1) TO '$2' WITH CSV HEADER"; }

# ---------------------------------------------------------------- schema ---
# Three forms deliberately. The custom-format archive is what you actually
# restore from (pg_restore, parallelisable, selective). The plain SQL is what
# a human reads and what Phase 0 diffs against Supabase/migrations/.
step "schema: public (plain SQL, for diffing against migrations)" \
  pg_dump "$DB_URL" --schema-only --no-owner --no-privileges \
    --schema=public --file="$OUT/schema/public-schema.sql"

step "schema: public + auth + storage (plain SQL, full reference)" \
  pg_dump "$DB_URL" --schema-only --no-owner \
    --schema=public --schema=auth --schema=storage \
    --file="$OUT/schema/all-schema.sql"

step "schema+data: custom-format archive (THIS is the restore artifact)" \
  pg_dump "$DB_URL" --format=custom --no-owner \
    --schema=public --schema=auth --schema=storage \
    --file="$OUT/schema/full.dump"

# ------------------------------------------------------------------ data ---
# Plain-SQL data is redundant with full.dump above and kept anyway: it is
# greppable, diffable, and restorable into a non-PostgreSQL target later
# without needing pg_restore.
step "data: public (plain SQL inserts)" \
  pg_dump "$DB_URL" --data-only --no-owner --column-inserts \
    --schema=public --file="$OUT/data/public-data.sql"

# auth.users separately: this is the one piece people forget, and without it
# every existing login is gone even with a perfect public-schema restore.
step "data: auth.users + auth.identities" \
  pg_dump "$DB_URL" --data-only --no-owner \
    --table=auth.users --table=auth.identities \
    --file="$OUT/data/auth-users.sql"

# -------------------------------------------------------------- inventory ---
# Everything below is for verification and for rebuilding things a dump does
# not carry (roles, cron jobs, bucket config, extension list).

step "inventory: roles" \
  bash -c "psql '$DB_URL' -At -c \"select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles order by rolname\" > '$OUT/inventory/roles.txt'"

step "inventory: extensions" \
  bash -c "psql '$DB_URL' -At -c \"select extname, extversion from pg_extension order by extname\" > '$OUT/inventory/extensions.txt'"

# The drift reconciliation list. Every SECURITY DEFINER / INVOKER function in
# public, with its full definition — this is where the nine missing RPCs live.
step "inventory: every function definition in public (drift reconciliation)" \
  bash -c "psql '$DB_URL' -At -c \"select p.proname || E'\n' || pg_get_functiondef(p.oid) || E'\n;\n' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname\" > '$OUT/inventory/public-functions.sql'"

step "inventory: function names + grants (what anon/authenticated can execute)" \
  bash -c "psql '$DB_URL' -At -c \"select p.proname, pg_get_function_identity_arguments(p.oid), has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by p.proname\" > '$OUT/inventory/function-grants.txt'"

step "inventory: RLS policies" \
  bash -c "psql '$DB_URL' -At -c \"select schemaname, tablename, policyname, cmd, roles::text, coalesce(qual,''), coalesce(with_check,'') from pg_policies order by schemaname, tablename, policyname\" > '$OUT/inventory/rls-policies.txt'"

step "inventory: tables with RLS enabled/disabled" \
  bash -c "psql '$DB_URL' -At -c \"select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname\" > '$OUT/inventory/rls-enabled.txt'"

step "inventory: triggers" \
  bash -c "psql '$DB_URL' -At -c \"select c.relname, t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth') order by c.relname, t.tgname\" > '$OUT/inventory/triggers.txt'"

# Migration history vs. repo filenames — the drift Supabase/README.md documents.
step "inventory: supabase_migrations.schema_migrations (live history)" \
  bash -c "psql '$DB_URL' -At -c \"select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version\" > '$OUT/inventory/live-migration-history.txt'"

# pg_cron jobs are configuration, not schema — a dump does not carry them.
step "inventory: pg_cron jobs" \
  bash -c "psql '$DB_URL' -At -c \"select jobid, schedule, command, nodename, active from cron.job order by jobid\" > '$OUT/inventory/cron-jobs.txt'"

step "inventory: realtime publication membership" \
  bash -c "psql '$DB_URL' -At -c \"select pubname, schemaname, tablename from pg_publication_tables order by pubname, tablename\" > '$OUT/inventory/realtime-publication.txt'"

step "inventory: storage buckets (config a file copy does not carry)" \
  bash -c "psql '$DB_URL' -At -c \"select id, name, public, file_size_limit, allowed_mime_types::text from storage.buckets order by id\" > '$OUT/inventory/storage-buckets.txt'"

step "inventory: storage object listing" \
  bash -c "psql '$DB_URL' -At -c \"select bucket_id, name, coalesce((metadata->>'size'),'') , created_at, updated_at from storage.objects order by bucket_id, name\" > '$OUT/inventory/storage-objects.txt'"

# Row counts, for verifying a restore actually landed everything.
step "inventory: row counts (restore verification baseline)" \
  bash -c "psql '$DB_URL' -At -c \"select 'employees', count(*) from public.employees union all select 'proximity_cards', count(*) from public.proximity_cards union all select 'scan_events', count(*) from public.scan_events union all select 'profiles', count(*) from public.profiles union all select 'auth.users', count(*) from auth.users order by 1\" > '$OUT/inventory/row-counts.txt'"

# --------------------------------------------------------------- summary ---
cat > "$OUT/MANIFEST.md" <<MANIFEST
# Supabase export — $(date -u +"%Y-%m-%dT%H:%M:%SZ")

Produced by \`Supabase/local/export-project.sh\`. Read-only against the project.

## Restore artifact
\`schema/full.dump\` — custom-format, restore with:

    pg_restore --no-owner --dbname "\$TARGET_URL" schema/full.dump

## Still NOT captured by this script — do these by hand
- **Storage object bytes.** \`inventory/storage-objects.txt\` lists what exists;
  the files themselves must be downloaded (dashboard, \`supabase storage cp\`,
  or the public URLs for the \`scan-sounds\` bucket).
- **Edge Function source.** \`supabase functions download <name>\` per function.
  \`Supabase/functions/\` in the repo is the tracked copy; confirm it matches live.
- **Secrets / env vars.** Project Settings > Edge Functions > Secrets, and the
  Google Drive credentials used by \`upload-employee-photo\`. These are not in
  the database and are not recoverable after project loss.
- **Auth provider config**, SMTP, redirect URLs, JWT secret, API keys.
- **Employee photos** live in Google Drive, not Supabase Storage — unaffected
  by anything happening to this project, but inventory the Drive folder.

## Verification
Compare \`inventory/row-counts.txt\` against the restored target before trusting it.
MANIFEST

echo
if [ "$failures" -gt 0 ]; then
  echo "Export finished with $failures failed step(s) — see the errors above." >&2
  echo "A partial export is still worth keeping, but DO NOT treat it as a complete backup." >&2
  exit 1
fi
echo "Export complete: $OUT"
echo "Read $OUT/MANIFEST.md — several things (storage bytes, secrets, Edge Function"
echo "source, auth provider config) are NOT captured here and need manual steps."
