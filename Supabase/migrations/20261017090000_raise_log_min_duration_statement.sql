-- Raise log_min_duration_statement from 200 ms to 1000 ms on the three
-- impersonated roles, to cut Postgres log ingestion.
--
-- Why: at 200 ms every qualifying statement is written to the Postgres log
-- *with its full statement text*. Measured 2026-10-15, the project was logging
-- ~40 such statements an hour — a similar order of ingestion to the ~670
-- permission-denied errors/day that 20261015120000 removed, and unlike those
-- this is traffic from healthy kiosks doing nothing wrong.
--
-- 200 ms was set during a performance investigation (see Supabase/README.md →
-- Query performance). It is a debugging threshold left switched on, not a
-- permanent operating setting. docs/EGRESS_BUDGET.md §"Rejected: move
-- scan_events to Drive" already named this as the one log-ingestion lever
-- actually under this app's control.
--
-- What is given up: statements between 200 ms and 1 s no longer appear in the
-- Postgres log. They are still counted, with mean/total/call counts, in
-- pg_stat_statements — which is what Settings → Query performance reads via
-- get_slow_query_stats(p_threshold_ms DEFAULT 200). That panel is unaffected
-- and its 200 ms default is deliberately left alone: it answers "what is slow",
-- which is a different question from "what should be written to the log".
--
-- 1000 ms still sits well under both statement_timeout values (anon 3 s,
-- authenticated 8 s), so anything heading for a timeout is still logged with
-- its text, which is the case the log is actually useful for.
--
-- MUST be the impersonated roles, not `authenticator` or `postgres`.
-- PostgREST connects as `authenticator` and SET ROLEs into anon/authenticated
-- per request (service_role for Edge Functions). Per PostgREST's "Impersonated
-- Role Settings", a role-level ALTER ROLE ... SET only applies when set on the
-- role actually impersonated. An earlier session set this on `postgres` and it
-- silently covered none of the app's traffic; that leftover is still in place
-- and is left alone here, since the postgres role is only migrations, the SQL
-- editor and MCP tooling -- a handful of statements a day, not a billing item.
ALTER ROLE anon          SET log_min_duration_statement = 1000;
ALTER ROLE authenticated SET log_min_duration_statement = 1000;
ALTER ROLE service_role  SET log_min_duration_statement = 1000;

-- PostgREST caches role config and will not pick up an ALTER ROLE until it is
-- told to reload. Without this the setting is real in the database but has no
-- effect on live traffic, which is the failure mode that makes this look like
-- it did not work.
NOTIFY pgrst, 'reload config';

-- Verify (expect 1000 on all three):
--   select r.rolname, s.setconfig
--     from pg_roles r
--     left join pg_db_role_setting s on s.setrole = r.oid
--    where r.rolname in ('anon', 'authenticated', 'service_role');
