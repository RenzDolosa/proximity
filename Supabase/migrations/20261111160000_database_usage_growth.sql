-- Settings -> Usage: make the database panel answer the question that
-- actually matters, and let it see the whole database.
--
-- MEASURED 2026-11-11, which is why this migration says what it says:
--
--   database                         92 MB of 500
--   public.scan_events               49 MB   171,032 live     100 dead
--   public.employees                 26 MB       814 live      95 dead
--   auth.refresh_tokens             968 kB
--   public.proximity_cards          912 kB
--   cron.job_run_details            728 kB         0 live
--   net._http_response               96 kB         8 live
--
-- Three things fall out of that, and all three contradict what the panel
-- was built to help with.
--
-- 1. THERE IS NOTHING TO RECLAIM. 100 dead tuples against 171,032, and 95
--    against 814 — autovacuum is comfortably ahead. The two machine-written
--    tables everyone expects to find unbounded are 728 kB with no live rows
--    and 96 kB with eight. Dropping every never-scanned index in `public`
--    would recover about 1.2 MB, and two of those are trigram indexes that
--    back employee search.
--
-- 2. THE PANEL COULD NOT HAVE TOLD ANYONE THAT. 20261005120000 filters
--    `WHERE n.nspname = 'public'`, so cron.job_run_details and
--    net._http_response were invisible — the two relations most likely to
--    grow without anybody deciding they should. They had not. Establishing
--    that took a hand-written catalog query.
--
-- 3. THE REAL NUMBER IS A SLOPE, AND NOTHING SHOWED IT. Storage is the one
--    Supabase quota that does not reset at the billing boundary, so the
--    only question worth asking is when the line crosses 500 MB. "18%"
--    reads the same whether it took six weeks or six years. It took seven
--    weeks.
--
-- WHAT THIS ADDS
--
--   * every schema except pg_catalog and information_schema, with the
--     schema name carried through, so nothing can grow unobserved again
--   * dead row counts per relation, so "large" and "reclaimable" stop being
--     the same column
--   * `growth`: the raw inputs for a rate — scan bytes, scan rows, and the
--     first and last scanned_at. The arithmetic is in Utils/dbGrowth.js,
--     where it is unit-tested, rather than here where it would not be.
--
-- WHY THE RATE COMES FROM SCAN VOLUME rather than a stored size history. A
-- trend needs two measurements. A history table would show nothing for
-- days, and would mean adding a table to solve a storage problem.
-- scan_events already records when it started and how many rows it holds;
-- at 49 MB of 92 it is the dominant term, and deriving from it costs one
-- index probe.
--
-- COST. Same single RPC, read on demand when an admin opens the panel,
-- never on a timer. A few hundred bytes larger than before. reltuples comes
-- from the catalog rather than count(*), and min/max(scanned_at) walks
-- idx_scan_events_scanned_at from both ends — so this does not read the
-- 171,032 rows it reports on.
--
-- SIGNATURE AND RETURN TYPE UNCHANGED, so this is a true CREATE OR REPLACE:
-- no DROP, no grant restatement needed, and a client deployed before this
-- migration keeps working — it reads database_bytes, database_limit_bytes,
-- tables[] and measured_at, all of which are still here and still mean what
-- they did. The new keys are additive.

CREATE OR REPLACE FUNCTION public.get_database_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- pg_stat_all_tables lives in pg_catalog, which is always on the path, but
-- the explicit setting is the project convention and stops a future edit
-- from resolving `employees` or `scan_events` somewhere unexpected.
SET search_path TO 'public'
AS $function$
DECLARE
  v_tables jsonb;
  v_growth jsonb;
BEGIN
  -- Unchanged from 20261005120000: admin only, deliberately stricter than
  -- the can_view_settings() gate the sibling panels use. SECURITY DEFINER
  -- because pg_database_size and pg_total_relation_size read catalog state
  -- the application roles are not granted; this check is what authorizes
  -- the call, not the caller's own privileges.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to view database usage';
  END IF;

  SELECT coalesce(jsonb_agg(t ORDER BY (t ->> 'total_bytes')::bigint DESC), '[]'::jsonb)
    INTO v_tables
    FROM (
      SELECT jsonb_build_object(
               -- NEW. Without this the caller cannot tell public.alerts
               -- from a hypothetical cron.alerts, and the rows from outside
               -- public would read as if they were application tables.
               'schema', n.nspname,
               'name', c.relname,
               'total_bytes', pg_total_relation_size(c.oid),
               'table_bytes', pg_table_size(c.oid),
               'index_bytes', pg_indexes_size(c.oid),
               -- reltuples is the planner's estimate and can be -1 on a
               -- relation that has never been analysed; greatest() keeps a
               -- negative out of the UI, where it would render as a count.
               'live_rows', greatest(coalesce(s.n_live_tup, c.reltuples)::bigint, 0),
               'dead_rows', coalesce(s.n_dead_tup, 0)
             ) AS t
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
       WHERE c.relkind IN ('r', 'p')
         -- Everything the project could plausibly fill, and nothing that is
         -- Postgres's own fixed overhead. `pg_toast` is excluded because
         -- pg_total_relation_size already folds a table's TOAST into its
         -- parent — listing both would double-count employees, whose jsonb
         -- scan_logs is most of its 26 MB.
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 12
    ) s;

  -- The slope's raw inputs. Both tables, because archival moves rows
  -- between them and counting only the live one would make the rate appear
  -- to drop the first time the archive job does something.
  SELECT jsonb_build_object(
           'scan_bytes',
             pg_total_relation_size('public.scan_events'::regclass)
             + pg_total_relation_size('public.scan_events_archive'::regclass),
           'scan_rows', (
             SELECT greatest(coalesce(sum(c.reltuples), 0), 0)::bigint
               FROM pg_class c
              WHERE c.oid IN ('public.scan_events'::regclass,
                              'public.scan_events_archive'::regclass)
           ),
           -- Index probes, not scans. Each of these walks one end of
           -- idx_scan_events_scanned_at (and its archive twin), so the
           -- panel does not read the rows it is reporting on.
           'first_scan_at', least(
             (SELECT min(scanned_at) FROM public.scan_events),
             (SELECT min(scanned_at) FROM public.scan_events_archive)
           ),
           'last_scan_at', greatest(
             (SELECT max(scanned_at) FROM public.scan_events),
             (SELECT max(scanned_at) FROM public.scan_events_archive)
           )
         )
    INTO v_growth;

  RETURN jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    -- Free plan ceiling, stated here so the UI has something to show a
    -- percentage against, and so the constant is not duplicated in the
    -- client. Update on a plan change.
    'database_limit_bytes', 524288000,  -- 500 MB
    'tables', v_tables,
    'growth', v_growth,
    'measured_at', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.get_database_usage() IS
  'Settings > Usage, database half. Every schema except pg_catalog/information_schema/pg_toast, with live and dead row counts, plus the raw inputs for a growth rate (scan bytes, scan rows, first and last scanned_at). The projection arithmetic lives in Utils/dbGrowth.js so it can be unit-tested. Admin only. Read on demand, never on a timer. See 20261111160000.';

-- Restated rather than assumed. A CREATE OR REPLACE keeps the existing ACL,
-- so these are describing the reachable surface rather than changing it --
-- the same convention 20261106140000 follows.
REVOKE ALL ON FUNCTION public.get_database_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_database_usage() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_database_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_usage() TO service_role;

-- The signature is unchanged, so PostgREST's cached one still resolves.
-- Kept because the convention is that a migration touching a function
-- reloads the cache; test/migration-conventions.test.mjs guards it.
NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
-- As ever, auth.uid() is NULL in psql so is_admin() is false and a bare
-- call raises. Borrow an admin id for one transaction and roll it back.
--
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object(
--         'sub', (select id from public.profiles where role = 'admin' limit 1),
--         'role', 'authenticated')::text, true);
--
--     -- 1. relations outside `public` are now visible -- this is the gap
--     select jsonb_path_query_array(
--              public.get_database_usage() -> 'tables',
--              '$[*] ? (@.schema <> "public").name');
--     -- expect at least auth.refresh_tokens on the 2026-11-11 figures.
--     -- An empty array means the nspname filter is back.
--
--     -- 2. the growth inputs are populated
--     select public.get_database_usage() -> 'growth';
--     -- expect scan_bytes, scan_rows, first_scan_at and last_scan_at, all
--     -- non-null. A null first_scan_at makes the panel report "not enough
--     -- history" rather than guessing, which is correct but not the
--     -- intended state here.
--
--     -- 3. dead rows are reported separately from size
--     select jsonb_path_query_array(
--              public.get_database_usage() -> 'tables', '$[*].dead_rows');
--   rollback;
--
--   -- 4. the panel must not read the rows it reports on. Look for index
--   -- scans, not a Seq Scan on scan_events.
--   explain (analyze, buffers) select min(scanned_at) from public.scan_events;
--
-- ROLLBACK -----------------------------------------------------------------
--
--   Re-apply 20261005120000. The client tolerates a missing `growth` key and
--   a missing `schema` -- it falls back to "not enough history" and to
--   'public' respectively -- so the panel degrades rather than breaking.
