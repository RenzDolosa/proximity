-- Prepares a vanilla PostgreSQL 17 database to receive a Supabase pg_dump.
--
-- A Supabase dump carries GRANT statements and RLS policies that name roles
-- the Supabase platform creates for you and that pg_dump does NOT include
-- (roles are cluster-level, not database-level, so they are outside a
-- per-database dump). Restoring without them produces a cascade of
-- `role "anon" does not exist` errors and a database whose RLS policies are
-- silently incomplete — which, for an access-control system, is the worst
-- possible failure mode: it restores "successfully" and enforces nothing.
--
-- Run this against the EMPTY target database, before pg_restore.
--   psql -d proximity_local -f bootstrap-roles.sql
--
-- See docs/SUPABASE_QUOTA_DECISION.md and docs/LOCAL_DATABASE_ARCHITECTURE.md.

-- 1. Roles ------------------------------------------------------------------
-- NOLOGIN by default: these are grant targets, not accounts. `authenticator`
-- is the one PostgREST actually connects as, switching into anon/authenticated
-- per request — give it a password only if you later run PostgREST locally.
do $$
declare
  r text;
begin
  foreach r in array array[
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'supabase_admin',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_realtime_admin',
    'supabase_read_only_user',
    'dashboard_user',
    'pgbouncer'
  ]
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
      raise notice 'created role %', r;
    end if;
  end loop;
end
$$;

-- authenticator switches into these at request time; without the membership
-- grant, `set role anon` fails and every anonymous request errors instead of
-- being correctly refused by RLS.
grant anon, authenticated, service_role to authenticator;

-- 2. Schemas ----------------------------------------------------------------
-- The dump creates auth/storage itself when those schemas were included, but
-- `extensions` and `graphql_public` are referenced by search_path settings and
-- grants without always being created. Cheap to pre-create.
create schema if not exists extensions;
create schema if not exists graphql_public;

-- 3. Extensions -------------------------------------------------------------
-- Only the ones a stock PostgreSQL 17 install actually ships (core + contrib).
create extension if not exists pgcrypto      with schema extensions;
create extension if not exists "uuid-ossp"   with schema extensions;
create extension if not exists pg_stat_statements;

-- Required, and easy to miss because nothing fails until pg_restore reaches
-- the indexes. The live schema has three trigram GIN indexes backing search —
-- idx_employees_full_name_trgm, idx_employees_code_trgm and
-- idx_proximity_code_trgm — all declared as
-- `USING gin (col extensions.gin_trgm_ops)`. Without pg_trgm in the
-- `extensions` schema specifically (the operator class is schema-qualified in
-- the dump), pg_restore logs "operator class extensions.gin_trgm_ops does not
-- exist" and SKIPS those three indexes. The restore still reports success and
-- every row count still matches, so the only symptom is that employee and
-- proximity-code search silently falls back to sequential scans — a local
-- database that looks identical to production and performs differently.
create extension if not exists pg_trgm       with schema extensions;

-- DELIBERATELY NOT CREATED, because stock PostgreSQL does not have them:
--
--   pg_cron        -- the archival / scan-log-trim / scanner-silence jobs.
--                     Available as a package (apt/yum) or you can replace the
--                     schedule with the host OS scheduler. Until then the
--                     cron.job rows captured by export-project.sh are a
--                     to-do list, not something that runs.
--   pg_graphql     -- Supabase-specific. Nothing in this app uses GraphQL.
--   pgjwt          -- Supabase-specific; only needed if you reimplement
--                     Supabase-compatible auth locally.
--   supabase_vault -- Supabase-specific secret storage.
--
-- pg_restore will log errors for each of these. Those specific errors are
-- EXPECTED and safe to ignore for a schema/data migration. Any OTHER error is
-- not — read the restore log rather than assuming.

-- 4. Verify -----------------------------------------------------------------
select rolname, rolcanlogin
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator')
order by rolname;
