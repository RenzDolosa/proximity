-- Two Settings-page defects, both visible in a single 60-second window of
-- Postgres logs on 2026-11-07 while verifying the Google Drive credentials:
--
--   12:05:11  duration: 1513.892 ms  get_scan_logs_trim_status()
--   12:05:10  duration: 1488.155 ms  get_scan_archive_status()
--   12:05:09  42P01  relation "pg_stat_statements" does not exist
--
-- Neither was reported by a user. Opening Settings is what fires all three.

-- ---------------------------------------------------------------------------
-- 1. Query performance panel: 42P01 relation "pg_stat_statements" does not exist
-- ---------------------------------------------------------------------------
--
-- The extension lives in schema `extensions` (the baseline creates it there,
-- line 6), but get_slow_query_stats() pins `SET search_path TO 'public'` and
-- then names the view unqualified. A function-level search_path REPLACES the
-- session's rather than extending it, so `extensions` is not on it and the
-- name cannot resolve. Same bug in reset_slow_query_stats(), which calls
-- pg_stat_statements_reset() unqualified -- unreported only because reaching
-- it needs a deliberate click through a confirm dialog.
--
-- THIS PANEL HAS LIKELY NEVER WORKED. Supabase/README.md records two
-- verifications of this feature -- "confirmed 1,458+ rows" and the
-- pg_has_role('postgres','pg_read_all_stats','member') membership check --
-- and both were run in the SQL Editor as `postgres`, whose search_path does
-- include `extensions`. Neither exercised the function. The gap between
-- "the query works" and "the query works from inside this function" is
-- exactly the gap a pinned search_path creates.
--
-- Fixed by extending the search_path rather than schema-qualifying the body,
-- because that needs no CREATE OR REPLACE: the bodies are untouched, so there
-- is nothing to re-review and no way to reintroduce a typo into 40 lines of
-- working SQL. On Supabase only superuser-ish roles hold CREATE on
-- `extensions`, so adding it to a SECURITY DEFINER search_path does not open
-- a shadowing path the way adding a user-writable schema would.

ALTER FUNCTION public.get_slow_query_stats(numeric, integer)
  SET search_path TO 'public', 'extensions';

ALTER FUNCTION public.reset_slow_query_stats()
  SET search_path TO 'public', 'extensions';

-- Fails loudly here rather than at the next admin's click if the extension
-- is absent entirely, which is the one case the ALTERs above cannot fix.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    RAISE EXCEPTION 'pg_stat_statements is not installed; the search_path fix '
      'above is not the whole story. Run: CREATE EXTENSION pg_stat_statements '
      'WITH SCHEMA extensions;';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. get_scan_logs_trim_status(): 1852 ms, for three integers
-- ---------------------------------------------------------------------------
--
-- The same defect 20261106180000 removed from employee_directory, left behind
-- in the one other place that counts scan log entries. Three
-- jsonb_array_length(scan_logs) calls across all 814 employees: scan_logs is
-- a jsonb column well over the 2 KB TOAST threshold on most rows, and reading
-- ANY part of a TOASTed value fetches every chunk, decompresses it and parses
-- it. ~28 MB of JSON walked three times to produce three numbers.
--
-- employees.scan_logs_count already exists and is maintained by
-- trg_sync_scan_logs_count() on BEFORE INSERT OR UPDATE OF scan_logs, with a
-- post-apply divergence check that returned wrong=0 missing=0 across all 814
-- rows. So this is a substitution, not a new mechanism -- there is nothing to
-- backfill and no new way for the number to drift.
--
-- Signature and return shape are byte-identical, so CREATE OR REPLACE is
-- valid and the client needs no change.

CREATE OR REPLACE FUNCTION public.get_scan_logs_trim_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_entries bigint;
  v_employees_with_entries bigint;
  v_max_entries integer;
  v_last_run jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view scan-log trim status';
  end if;

  -- Was sum/count/max over jsonb_array_length(scan_logs). Identical results,
  -- read from the counter column instead of by de-TOASTing the array.
  select coalesce(sum(scan_logs_count), 0),
         count(*) filter (where scan_logs_count > 0),
         coalesce(max(scan_logs_count), 0)
  into v_total_entries, v_employees_with_entries, v_max_entries
  from public.employees;

  begin
    select jsonb_build_object('status', jrd.status, 'started_at', jrd.start_time,
                               'ended_at', jrd.end_time, 'message', jrd.return_message)
    into v_last_run
    from cron.job_run_details jrd
    join cron.job j on j.jobid = jrd.jobid
    where j.jobname = 'trim-employee-scan-logs'
    order by jrd.start_time desc
    limit 1;
  exception when others then
    v_last_run := null;
  end;

  return jsonb_build_object(
    'total_entries', v_total_entries,
    'employees_with_entries', v_employees_with_entries,
    'max_entries_for_one_employee', v_max_entries,
    'last_run', v_last_run
  );
end;
$function$;

COMMENT ON FUNCTION public.get_scan_logs_trim_status() IS
  'Settings -> Scan log trimming. Counts read employees.scan_logs_count, NOT jsonb_array_length(scan_logs); see 20261107130000 for the 1.85s that change removes.';

-- Strictly unnecessary: no signature moved, and the CREATE OR REPLACE keeps
-- argument and return types identical, so PostgREST's cache is already
-- correct. It is here because migration-conventions.test.mjs requires it of
-- every migration that writes a function, and that rule is deliberately
-- coarse -- it exists so no author has to be right about what PostgREST
-- cached. Two migrations shipped eight RPCs that would have 404'd by
-- reasoning the other way. A free statement is cheaper than an exemption.
NOTIFY pgrst, 'reload schema';

-- get_scan_archive_status() shares the window (1488 ms) and is deliberately
-- NOT touched. Its cost is a plain count(*) over 150,504 scan_events rows --
-- volume, not TOAST -- and the only way to make that cheap is a reltuples
-- estimate, which would quietly change a figure the panel presents as exact.

-- VERIFY --
--
--   -- 1. both functions can now see the extension
--   select proname, proconfig
--   from pg_proc
--   where proname in ('get_slow_query_stats', 'reset_slow_query_stats');
--   -- expect: {search_path=public,extensions}
--
--   -- 2. the counter still agrees with the arrays it replaced
--   select count(*) filter (where scan_logs_count
--            is distinct from coalesce(jsonb_array_length(scan_logs), 0)) as diverged,
--          count(*) as employees
--   from public.employees;
--   -- expect: diverged = 0
--
--   -- 3. and the readout is unchanged, just fast
--   select public.get_scan_logs_trim_status();
