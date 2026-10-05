#!/usr/bin/env bash
# Applies Supabase/migrations/*.sql in filename order to one database, stopping
# at the first failure and naming the file that failed.
#
# This is the Phase 0 tool for the local-database plan (see
# docs/LOCAL_DATABASE_ARCHITECTURE.md): before anything can run PostgreSQL per
# site, Supabase/migrations/ has to be able to build a working schema from
# empty. Today it cannot — see the "known drift" note below — and the point of
# this script is to make that failure explicit and repeatable instead of
# something you discover halfway through a migration project.
#
# Usage:
#   ./apply-migrations.sh                      # against a running `supabase start` stack
#   ./apply-migrations.sh "postgresql://..."   # against any other database
#
# The default target is the Supabase CLI's local stack rather than a bare
# PostgreSQL container on purpose. The committed schema depends on things the
# Supabase platform provides and a vanilla `postgres:17` image does not: the
# anon/authenticated/service_role roles, the auth schema behind auth.uid() and
# the trg_on_auth_user_created trigger on auth.users, storage.buckets and
# storage.objects for the scan-sounds bucket, and the pg_cron/pg_stat_statements
# extensions. `supabase start` supplies all of that, so Phase 0 can validate
# the *migrations* without also having to first write a Supabase-compatibility
# layer. Replacing that platform surface is a later phase with its own
# prerequisites, deliberately not mixed into this one.
#
# Known drift (as of 2026-10-05): this will fail on
# 20261002000000_scanner_silence_alerts.sql, which calls public.raise_alert()
# and reads public.scanners / public.alerts — none of which any migration in
# this repo creates. That is the first thing Phase 0 has to fix. The same gap
# is asserted, with its current contents pinned, by test/schema-drift.test.mjs.
set -euo pipefail

cd "$(dirname "$0")/../migrations"

DB_URL="${1:-}"
if [ -z "$DB_URL" ]; then
  if ! command -v supabase >/dev/null 2>&1; then
    echo "error: no database URL given and the supabase CLI is not installed." >&2
    echo "       install it (https://supabase.com/docs/guides/local-development)," >&2
    echo "       run 'supabase start', or pass a postgresql:// URL as \$1." >&2
    exit 2
  fi
  # `supabase status` prints the local stack's connection strings; take the
  # DB one. If the stack isn't running this fails loudly, which is correct.
  DB_URL="$(supabase status -o env 2>/dev/null | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
  if [ -z "$DB_URL" ]; then
    echo "error: could not read DB_URL from 'supabase status'. Is the stack running ('supabase start')?" >&2
    exit 2
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not on PATH (install the PostgreSQL client tools)." >&2
  exit 2
fi

applied=0
for file in $(ls -1 *.sql | sort); do
  echo "==> $file"
  # ON_ERROR_STOP=1 plus --single-transaction: a migration either applies
  # whole or not at all, so a failure halfway through doesn't leave the
  # database in a state that makes the *next* run's error misleading.
  if ! psql "$DB_URL" --set ON_ERROR_STOP=1 --single-transaction --quiet --file "$file"; then
    echo >&2
    echo "FAILED at $file (after $applied applied cleanly)." >&2
    echo "If this is 20261002000000_scanner_silence_alerts.sql, see the known-drift" >&2
    echo "note at the top of this script and docs/LOCAL_DATABASE_ARCHITECTURE.md." >&2
    exit 1
  fi
  applied=$((applied + 1))
done

echo
echo "All $applied migration(s) applied cleanly."
echo "Next: run the RPC/RLS integration checks against this database before trusting it"
echo "as the schema of record (see docs/LOCAL_DATABASE_ARCHITECTURE.md, Phase 0)."
