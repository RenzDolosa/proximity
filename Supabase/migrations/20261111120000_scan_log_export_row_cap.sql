-- "Export all scan logs" has been producing EXACTLY 1,000 rows and calling it
-- finished. Reported 2026-11-11 as "the export is missing rows".
--
-- Not a bug in the SQL. PostgREST enforces `db-max-rows` on every response,
-- and this project deliberately sets it to 1000 (Supabase/README.md, "Added
-- pgrst.db_max_rows = 1000"). It is applied AFTER the function's own LIMIT and
-- it is silent to the caller: the response is a 206 with a Content-Range
-- header, which supabase-js does not surface. The body is simply shorter.
--
-- So the paged export walked itself into a dead end on page one:
--
--   1. the client asks get_scan_events_page for 10,000 rows
--   2. the function computes 10,000
--   3. PostgREST returns the first 1,000
--   4. the client sees 1,000 < 10,000, concludes "short page = end of data",
--      and stops
--
-- Every export since 20261106150000 therefore held the newest 1,000 scans.
-- The export ledger records it plainly in hindsight -- five runs, five
-- different date ranges, `row_count` of exactly 1000 every time.
--
-- WHY THIS WAS MISSED. The cap is already known here: Utils/rowCap.js names
-- it, 20261008160000 was written about it, and the Attendance export sets its
-- page size to exactly 1000 with the comment "PostgREST refuses more than 1000
-- rows per response whatever we ask for". The scan-log export was written with
-- a page size of 10,000 and a header comment claiming "pages of 10,000 never
-- approach the statement timeout". They never existed.
--
-- THE FIX: RETURN ONE ROW INSTEAD OF MANY.
--
-- `db-max-rows` caps the number of ROWS in a response. A function returning
-- `SETOF`/`RETURNS TABLE` is a set and gets capped; a function returning a
-- scalar `jsonb` returns one row and cannot be. The page size then means what
-- it says, and it is set by this function -- which is clamped and reviewable
-- in a diff -- rather than by a project-wide dashboard setting that applies to
-- every endpoint at once.
--
-- The alternative was to raise `db-max-rows`. Rejected twice over: it would
-- lift the ceiling on every table, view and RPC in the project to serve one
-- admin-gated export, and it lives only in the dashboard. This codebase has
-- already been bitten for seven weeks by a setting that existed nowhere in the
-- repo ("Allow new users to sign up"), and the whole point of `db_max_rows`
-- here is to stop an accidental query shipping a huge response.
--
-- WHAT IT COSTS. Egress: unchanged, to the byte -- the same 150,504 rows cross
-- the wire either way, and jsonb_agg emits the same keys PostgREST would have.
-- Log ingestion: it goes DOWN. A full export is 16 requests at 10,000 rows a
-- page instead of the 151 it would take at 1,000, and instead of the 1 it has
-- been taking while silently returning a sixth of a percent of the data.
--
-- THE RETURN SHAPE CARRIES THE PAGE SIZE: {"limit": <int>, "rows": [...]}.
-- The client compares against the limit the SERVER says it used, not the one
-- the client asked for. That is the specific assumption that broke here, and
-- stating the real number in the response is what stops it breaking again
-- after some future change to the clamp.
--
-- BACKWARD COMPATIBILITY. The return TYPE changes, so this is a DROP and a
-- recreate rather than a true CREATE OR REPLACE. The argument list is
-- byte-identical, so no stale overload survives the drop and no call site
-- becomes ambiguous. Utils/exportChunking.js reads BOTH shapes -- the object
-- below and a bare array from the old definition -- so the migration and the
-- frontend can land in either order without an export breaking in between.

-- Required before the recreate: CREATE OR REPLACE cannot change a return type
-- ("cannot change return type of existing function"). IF EXISTS so the file is
-- re-runnable, which these are, because they get applied by hand in the SQL
-- Editor where a failure halfway through leaves the earlier statements
-- committed.
DROP FUNCTION IF EXISTS public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer);

CREATE OR REPLACE FUNCTION public.get_scan_events_page(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_after_scanned_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  -- Clamped so a client cannot ask for the whole table in one page and
  -- recreate the statement timeout by hand. This is now the ONLY ceiling on a
  -- page -- PostgREST no longer imposes a second, smaller one behind it -- so
  -- it is the number reported back in the response.
  v_limit integer := greatest(1, least(coalesce(p_limit, 10000), 25000));
  v_out jsonb;
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to export scan history';
  end if;

  with capped as materialized (
    select ev.id, ev.proximity_code, ev.employee_id, ev.scanner_id,
           ev.result, ev.scanned_at
    from (
      select se.id, se.proximity_code, se.employee_id, se.scanner_id,
             se.result, se.scanned_at
      from public.scan_events se
      where (p_from is null or se.scanned_at >= p_from)
        and (p_to is null or se.scanned_at <= p_to)
        -- Row-wise comparison, not `scanned_at < x or (= x and id < y)`:
        -- the tuple form is what lets the planner use the scanned_at index
        -- as a starting position rather than filtering after the fact.
        and (p_after_scanned_at is null
             or (se.scanned_at, se.id) < (p_after_scanned_at, p_after_id))
      union all
      select sa.id, sa.proximity_code, sa.employee_id, sa.scanner_id,
             sa.result, sa.scanned_at
      from public.scan_events_archive sa
      where (p_from is null or sa.scanned_at >= p_from)
        and (p_to is null or sa.scanned_at <= p_to)
        and (p_after_scanned_at is null
             or (sa.scanned_at, sa.id) < (p_after_scanned_at, p_after_id))
    ) ev
    -- id breaks ties on scanned_at. Without it, two scans sharing a
    -- timestamp could straddle a page boundary in an unstable order and be
    -- silently dropped or duplicated between pages.
    order by ev.scanned_at desc, ev.id desc
    limit v_limit
  ),
  -- One pass over scan_logs for the employees actually in the result,
  -- hash-joined below. NOT a correlated subquery per row: that shape is what
  -- made this time out in the first place, and test/scan-log-export.test.mjs
  -- fails if it comes back. See 20261106140000.
  directions as (
    select distinct on (e.id, l.elem ->> 'scan_id')
           e.id as employee_id,
           (l.elem ->> 'scan_id') as scan_id,
           (l.elem ->> 'direction') as direction
    from public.employees e
    cross join lateral jsonb_array_elements(e.scan_logs) as l(elem)
    where e.id in (select c.employee_id from capped c where c.employee_id is not null)
    order by e.id, (l.elem ->> 'scan_id')
  ),
  -- Column names here become the JSON keys, so they must match what the old
  -- RETURNS TABLE declared -- ExportScanLogsModal.js reads them by name.
  page_rows as (
    select c.id, c.scanned_at, e.full_name as employee_name, e.department,
           c.proximity_code, c.scanner_id, c.result, d.direction
    from capped c
    left join public.employees e on e.id = c.employee_id
    left join directions d
           on d.employee_id = c.employee_id
          and d.scan_id = c.id::text
  )
  select jsonb_build_object(
    'limit', v_limit,
    -- coalesce because jsonb_agg over zero rows is NULL, not '[]'. A null here
    -- would reach the client as `rows: undefined` and read as a malformed
    -- response instead of the empty last page that it is.
    --
    -- The ORDER BY belongs INSIDE the aggregate: a plain `order by` on the
    -- outer select orders the one row being aggregated into, which is a no-op,
    -- and the array would come back in whatever order the join produced. The
    -- cursor is built from the LAST element, so an unordered array does not
    -- merely look untidy -- it makes the next page start from an arbitrary
    -- row and silently skip everything between.
    'rows', coalesce(
      jsonb_agg(to_jsonb(p) order by p.scanned_at desc, p.id desc),
      '[]'::jsonb
    )
  )
  into v_out
  from page_rows p;

  return v_out;
end;
$function$;

COMMENT ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) IS
  'Keyset-paged "Export all scan logs". Returns {"limit": n, "rows": [...]} as a SINGLE jsonb value, not a set: PostgREST db_max_rows is 1000 here and silently truncates a set-returning RPC, which capped every export at 1,000 rows. Pass the previous page''s last (scanned_at, id) as the cursor; a page shorter than the returned limit is the end. See 20261111120000.';

-- Restated after the DROP, which took the old ACL with it. Without these the
-- function would fall back to the default EXECUTE-to-PUBLIC grant, which on a
-- SECURITY DEFINER export of everyone's scan history is the one grant that
-- must never be implicit. The is_admin_or_manager() gate inside would still
-- hold, but defence in depth is the convention here.
REVOKE ALL ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) TO authenticated;

-- The return type changed, so PostgREST's cached schema describes a function
-- that no longer exists. Without this the export answers PGRST202 until the
-- cache happens to refresh. test/migration-conventions.test.mjs guards it.
NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
-- READ THIS FIRST. `db-max-rows` is enforced by PostgREST, not by Postgres.
-- A psql session does not go through PostgREST, so the 1,000-row truncation
-- IS NOT REPRODUCIBLE HERE -- the old set-returning definition also returns
-- 5,000 rows when called from psql. "I ran the function in the SQL Editor and
-- got more than 1,000" therefore proves nothing about the bug.
--
-- What psql can settle is the RETURN TYPE, which is the whole mechanism: the
-- cap limits how many ROWS a response may contain, and a scalar is one row.
-- Check 1 is the proof. The end-to-end confirmation is check 5, in a browser.
--
--   -- 1. THE PROOF: it returns one jsonb value, not a set
--   select pg_get_function_result(oid) from pg_proc
--   where proname = 'get_scan_events_page' and pronamespace = 'public'::regnamespace;
--   -- expect: jsonb   (NOT "TABLE(...)" -- that version is what gets capped)
--
--   -- 2. exactly one definition survived the drop
--   select count(*) from pg_proc
--   where proname = 'get_scan_events_page' and pronamespace = 'public'::regnamespace;
--   -- expect: 1   (2 means a stale overload, and calls become ambiguous)
--
--   -- 3. the DROP took the ACL with it, so the grants must be back
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'get_scan_events_page' and routine_schema = 'public';
--   -- expect: authenticated/EXECUTE, and postgres. NOT anon, NOT PUBLIC.
--
--   -- 4. the body behaves, with the admin gate satisfied.
--   -- is_admin_or_manager() reads auth.uid(), which is NULL in psql, so a
--   -- bare call raises 'not permitted to export scan history'. Borrow a real
--   -- admin's id for the length of one transaction and roll it back.
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object(
--         'sub', (select id from public.profiles where role = 'admin' limit 1),
--         'role', 'authenticated')::text, true);
--     select jsonb_array_length(public.get_scan_events_page(null,null,null,null,5000) -> 'rows') as rows_in_page,
--            public.get_scan_events_page(null,null,null,null,999999) -> 'limit' as clamped_limit;
--   rollback;
--   -- expect rows_in_page 5000 (or the total, if fewer exist) and
--   -- clamped_limit 25000. This confirms the shape and the clamp. It does
--   -- NOT confirm the fix -- see the note at the top.
--
--   -- 5. THE END-TO-END CHECK, and the only one that exercises PostgREST.
--   select (select count(*) from public.scan_events)
--        + (select count(*) from public.scan_events_archive) as expected_rows;
--   -- Then run "Export all scan logs" with no date range in the browser and
--   -- compare the ROWS column in Export Manager. They must match. Anything
--   -- that lands on exactly 1000 means the frontend has not shipped yet.
--
-- ROLLBACK -----------------------------------------------------------------
--
--   Re-apply 20261106150000, which recreates the RETURNS TABLE version.
--   Utils/exportChunking.js reads that shape too, so the export keeps working
--   -- capped at 1,000 rows per page again, which is the bug this fixed.
