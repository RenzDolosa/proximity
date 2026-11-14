-- Let the archive horizon go down to 30 days, and make that safe first.
--
-- THE FLOOR WAS LOAD-BEARING, NOT CAUTIOUS. Archiving moves rows out of
-- scan_events, and Scanner Analytics reads scan_events ONLY — 20260930000000
-- records that get_all_scan_events() was "the one place that needs to read
-- scan_events_archive too". get_scanner_scan_details() clamps its window to
-- 1..90 days. So archiving at 30 would have left days 31-90 of that drilldown
-- silently empty: no error, no message, just fewer rows than there are.
--
-- Lowering the floor without fixing that would ship exactly the class of bug
-- this project has spent a week removing — a thing that looks like it is
-- working.
--
-- SO THE FUNCTION LEARNS TO READ THE ARCHIVE, the same way the export
-- already does (get_scan_events_page, 20261111120000). After this the
-- archive horizon stops being a limit on what anyone can see and becomes
-- purely what it should always have been: how many rows sit in the hot
-- table. At that point 30 is as defensible as 180.
--
-- ⚠ ONE HALF OF THIS IS NOT DONE, AND CANNOT BE DONE FROM THIS REPOSITORY.
-- get_scanner_performance_stats() — the counts across the top of Scanner
-- Analytics — has NO migration anywhere in Supabase/migrations/. It is
-- live-only, created through the dashboard SQL editor, and is listed in
-- KNOWN_MISSING_FUNCTIONS in test/schema-drift.test.mjs. Its body cannot be
-- read from here, so it cannot be rewritten here, and it still reads the
-- live table only.
--
-- Until it is captured and given the same union, setting the horizon below
-- 90 means: the drilldown list is complete, the summary counts above it are
-- not. To fix it, dump the definition and it can be migrated properly:
--
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'get_scanner_performance_stats';
--
-- COST: none. The union reads an indexed column on a table that is currently
-- empty, and idx_scan_events_archive_scanned_at already exists
-- (20260930000000 line 51).

-- ---------------------------------------------------------------------------
-- 1. The drilldown reads both tables
-- ---------------------------------------------------------------------------
--
-- Shape unchanged: same arguments, same returned columns, same order and
-- limit. Only the source widens, so AnalyticsPage.js needs no change.
--
-- count(*) over () stays OUTSIDE the union, computed over the combined set —
-- putting it inside either branch would report that branch's size and the
-- pagination total would be wrong by exactly the number of archived rows.
-- SIGNATURE AND RETURN TYPE COPIED VERBATIM FROM 20260928080000, not
-- reconstructed from the SELECT list. The first attempt at this migration
-- guessed them and failed on apply with "cannot change return type of
-- existing function": the real OUT columns are `scan_id` and
-- `employee_name`, not `id` and `full_name`, and the real parameter order is
-- (p_days, p_filter, p_scanner_id, p_limit). Nothing was committed, but a
-- guess that happens to keep the same (integer, text, text, integer)
-- signature is the dangerous version of this mistake — it would have
-- swapped what the two text arguments mean for any positional caller.
--
-- #variable_conflict use_column is carried over too: several OUT parameters
-- (scanned_at, scanner_id, result) share names with columns in the query.
CREATE OR REPLACE FUNCTION public.get_scanner_scan_details(
  p_days integer DEFAULT 7,
  p_filter text DEFAULT 'all',
  p_scanner_id text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
 RETURNS TABLE(
   scan_id uuid,
   scanned_at timestamp with time zone,
   employee_name text,
   employee_code text,
   department text,
   proximity_code text,
   scanner_id text,
   result text,
   captured_offline boolean,
   total_count bigint
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_since timestamptz := now() - (greatest(1, least(coalesce(p_days, 7), 90)) || ' days')::interval;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_filter text := coalesce(p_filter, 'all');
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to view scanner performance';
  end if;

  if v_filter not in ('all', 'matched', 'unmatched', 'inactive_card', 'inactive_employee', 'unassigned_card', 'offline') then
    raise exception 'unknown scan filter: %', v_filter;
  end if;

  return query
    with rows_in_window as (
      select se.id, se.scanned_at, se.employee_id, se.proximity_code,
             se.scanner_id, se.result, se.raw_payload
        from public.scan_events se
       where se.scanned_at >= v_since
      union all
      -- The archive half. Empty today; the only reason this exists is so a
      -- horizon shorter than the 90-day window above does not quietly
      -- shorten the window itself.
      select sa.id, sa.scanned_at, sa.employee_id, sa.proximity_code,
             sa.scanner_id, sa.result, sa.raw_payload
        from public.scan_events_archive sa
       where sa.scanned_at >= v_since
    )
    select r.id,
           r.scanned_at,
           e.full_name,
           e.employee_code,
           e.department,
           r.proximity_code,
           r.scanner_id,
           r.result,
           coalesce((r.raw_payload->>'captured_offline')::boolean, false),
           count(*) over ()
    from rows_in_window r
    left join public.employees e on e.id = r.employee_id
    where (p_scanner_id is null or r.scanner_id = p_scanner_id)
      and (
        v_filter = 'all'
        or (v_filter = 'offline' and (r.raw_payload->>'captured_offline')::boolean is true)
        or (v_filter <> 'offline' and r.result = v_filter)
      )
    order by r.scanned_at desc
    limit v_limit;
end;
$function$;

COMMENT ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) IS
  'Scanner Analytics drilldown over scan_events UNION scan_events_archive, so the 90-day window stays complete however short the archive horizon is. count(*) over () is computed on the combined set. Rewritten 2026-11-14 when the archive floor dropped to 30.';

REVOKE ALL ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The floor comes down to 30
-- ---------------------------------------------------------------------------
--
-- ONLY the archive horizon. trim_employee_scan_logs() keeps its floor of 90,
-- because that one DELETES and get_attendance_report() asks for ranges up to
-- 31 days — a 30-day trim horizon would mean a one-month attendance report
-- racing the job that is removing the month it is reporting on.
ALTER TABLE public.retention_settings
  DROP CONSTRAINT IF EXISTS retention_settings_scan_events_days_check;
ALTER TABLE public.retention_settings
  ADD CONSTRAINT retention_settings_scan_events_days_check
  CHECK (scan_events_days = 0 OR (scan_events_days >= 30 AND scan_events_days <= 3650));

CREATE OR REPLACE FUNCTION public.set_archive_days(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_days integer := coalesce(p_days, 0);
  v_tz text;
  v_from date;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change retention settings';
  end if;

  if v_days <> 0 and (v_days < 30 or v_days > 3650) then
    raise exception 'archive horizon must be 0 (never archive) or between 30 and 3650 days';
  end if;

  select tz into v_tz from public.retention_settings where id;
  v_tz := coalesce(v_tz, 'Asia/Manila');
  v_from := case when v_days = 0 then null
                 else ((now() at time zone v_tz)::date + 1) end;

  update public.retention_settings
     set scan_events_days = v_days,
         scan_events_effective_from = v_from,
         updated_at = now(),
         updated_by = auth.uid()
   where id;

  perform public.log_audit_event(
    'archive_horizon_changed', 'retention_settings', 'retention',
    jsonb_build_object('scan_events_days', v_days, 'effective_from', v_from, 'tz', v_tz));

  return public.get_retention_settings();
end;
$function$;

REVOKE ALL ON FUNCTION public.set_archive_days(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_archive_days(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_archive_days(integer) TO authenticated;

-- The job's own floor, which was never explicit — it took whatever the
-- setting said, and the CHECK was the only guard. Stated here so the
-- function cannot be reached past the constraint by a future caller.
CREATE OR REPLACE FUNCTION public.archive_old_scan_events(p_older_than_days integer DEFAULT NULL)
RETURNS TABLE(archived_count integer, cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_set_days integer;
  v_from date;
  v_tz text;
  v_days integer;
  v_cutoff timestamptz;
  v_count integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan archival';
  end if;

  select scan_events_days, scan_events_effective_from, tz
    into v_set_days, v_from, v_tz
    from public.retention_settings where id;

  if coalesce(v_set_days, 180) = 0 then
    return query select 0, null::timestamptz;
    return;
  end if;

  if v_from is not null
     and (now() at time zone coalesce(v_tz, 'Asia/Manila'))::date < v_from then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- Floored at 30 to match the CHECK, so a row written before this migration
  -- (or by a direct UPDATE that bypassed set_archive_days) cannot push the
  -- cutoff nearer than the drilldown can now reach back.
  v_days := greatest(30, coalesce(v_set_days, 180));
  v_days := greatest(v_days, coalesce(p_older_than_days, v_days));
  v_cutoff := now() - make_interval(days => v_days);

  WITH moved AS (
    DELETE FROM public.scan_events
    WHERE scanned_at < v_cutoff
    RETURNING id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload
  )
  INSERT INTO public.scan_events_archive
    (id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload)
  SELECT id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload
  FROM moved;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count, v_cutoff;
end;
$function$;

REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_scan_events(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run through Supabase/local/Invoke-Sql.ps1)
--
-- 1. The drilldown covers both tables. With the archive empty these must be
--    identical; after archiving at 30 days they must STILL be identical,
--    which is the whole point:
--
--      select count(*) from public.get_scanner_scan_details(90, null, 'all', 1000);
--      select (select count(*) from public.scan_events where scanned_at >= now() - interval '90 days')
--           + (select count(*) from public.scan_events_archive where scanned_at >= now() - interval '90 days');
--
-- 2. 30 is now accepted, and 29 is not:
--
--      begin;
--        select public.set_archive_days(30);   -- allowed, effective tomorrow
--      rollback;
--      begin;
--        select public.set_archive_days(29);   -- expect: ERROR
--      rollback;
--
-- 3. The trim floor is UNCHANGED at 90:
--
--      begin;
--        select public.set_retention_days(30); -- expect: ERROR
--      rollback;
--
-- 4. THE HALF THIS MIGRATION CANNOT FIX. Dump the live-only function so it
--    can be captured and given the same union:
--
--      select pg_get_functiondef(p.oid)
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'get_scanner_performance_stats';
--
--    Until then, with a horizon under 90 the drilldown list is complete and
--    the summary counts above it are not.
