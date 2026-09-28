-- Scanner Analytics drill-down: the rows behind each stat card / scanner row.
--
-- get_scanner_performance_stats() only returns counts. Clicking a card on the
-- Analytics page needs the underlying scan_events, so this is its row-level
-- twin: same permission gate (is_admin() OR can_view_scanner()), same time
-- window expression (now() - p_days days, p_days clamped to 1..90), and the
-- same definition of "offline" (raw_payload->>'captured_offline' is true), so
-- a card's number and the list it opens are counting the same rows.
--
-- p_filter is a closed list (anything else raises) — it is compared to
-- scan_events.result / the offline flag, never concatenated into SQL.
-- p_limit is clamped to 1..1000; total_count is the UNCAPPED match count so
-- the UI can say "showing 500 of 2,214".
--
-- Read-only, additive: no table, RLS or grant changes to anything existing.

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
    select se.id,
           se.scanned_at,
           e.full_name,
           e.employee_code,
           e.department,
           se.proximity_code,
           se.scanner_id,
           se.result,
           coalesce((se.raw_payload->>'captured_offline')::boolean, false),
           count(*) over ()
    from public.scan_events se
    left join public.employees e on e.id = se.employee_id
    where se.scanned_at >= v_since
      and (p_scanner_id is null or se.scanner_id = p_scanner_id)
      and (
        v_filter = 'all'
        or (v_filter = 'offline' and (se.raw_payload->>'captured_offline')::boolean is true)
        or (v_filter <> 'offline' and se.result = v_filter)
      )
    order by se.scanned_at desc
    limit v_limit;
end;
$function$;

-- Project convention: new functions default to EXECUTE for PUBLIC — revoke,
-- then grant to signed-in users only (the function's own role check is the
-- real gate; this just keeps anon from even reaching it).
REVOKE ALL ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_scan_details(integer, text, text, integer) TO authenticated;
