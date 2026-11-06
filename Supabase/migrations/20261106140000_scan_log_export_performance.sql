-- "Export all scan logs" returned `canceling statement due to statement
-- timeout`. Not because the result set is large -- because the query was
-- quadratic.
--
-- get_all_scan_events() (last touched by 20260930000000) resolved each
-- row's IN/OUT direction with a correlated subquery:
--
--     (select elem->>'direction'
--      from jsonb_array_elements(e.scan_logs) as elem
--      where elem->>'scan_id' = se.id::text
--      limit 1)
--
-- That unpacks the employee's ENTIRE scan_logs array once per exported row
-- and linear-scans it for one match. The work grows with the SQUARE of how
-- much each person scans, which is why this worked when the trim-job
-- migration (20261001041500) could write "most of 729 employees average 17
-- entries total" and does not now.
--
-- MEASURED ON PRODUCTION 2026-11-06, after this was written: 150,504 rows in
-- scan_events, and a largest scan_logs array of 1,325 entries. The heaviest
-- employee alone therefore costs on the order of 1,325 x 1,325, about 1.8
-- MILLION element comparisons, and every other employee adds their own
-- square on top.
--
-- A GUESS THAT TURNED OUT NOT TO APPLY, left here because the reasoning
-- becomes true later. This file originally argued that "All dates" fails
-- specifically because trim_employee_scan_logs() deletes scan_logs entries
-- past 180 days while scan_events_archive keeps the scan rows forever, so
-- archived rows scan a full array for an entry that was deliberately
-- deleted. That mechanism is real, but scan_events_archive held ZERO rows
-- when measured -- nothing is old enough to have been archived yet. The
-- quadratic term was sufficient on its own. Expect the archive effect to
-- start contributing once the data passes 180 days.
--
-- THREE CHANGES, and no signature change. The argument types and the
-- RETURNS TABLE column list are byte-identical, so this is a true CREATE OR
-- REPLACE -- no DROP, and no stale overload of the kind 20261009000000 had
-- to clean up (see README).
--
--   1. The date filter moves INSIDE each union branch, so
--      idx_scan_events_scanned_at and idx_scan_events_archive_scanned_at
--      can both be used, instead of filtering after the append.
--
--   2. The 100,000-row cap is applied BEFORE directions are looked up.
--      Previously the direction subquery ran for every matching row in all
--      of history and the cap was applied to what came out.
--
--   3. scan_logs is expanded ONCE into a hash-joinable set instead of once
--      per row. This is the change that removes the quadratic term; the
--      other two make it cheap rather than merely finite.
--
-- IDENTICAL RESULTS, not merely similar. The direction lookup was a scalar
-- subquery, so it never added or removed rows -- moving it after the LIMIT
-- cannot change which rows come back, only how many times the array is
-- walked. Archived rows still return a null direction, exactly as before,
-- because their scan_logs entries really are gone; ExportScanLogsModal.js
-- already renders that as an em dash.
--
-- COSTS NOTHING in egress or log ingestion: same single request, same rows,
-- same bytes on the wire. It just finishes.

CREATE OR REPLACE FUNCTION public.get_all_scan_events(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(scanned_at timestamptz, employee_name text, department text, proximity_code text, scanner_id text, result text, direction text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- Kept from the previous definition: several OUT parameters above
-- (proximity_code, scanner_id, result, scanned_at) share a name with a
-- column below, which PL/pgSQL otherwise reports as ambiguous. Every
-- reference is table-qualified as well -- the pragma is the safety net, not
-- the mechanism.
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to export scan history';
  end if;

  return query
    -- MATERIALIZED is explicit rather than relying on PG12+ auto-materialising
    -- a CTE referenced twice: this must be computed ONCE. If it were inlined
    -- into both references, the top-N over the union would run twice and the
    -- second copy would feed the direction lookup -- reintroducing most of
    -- the cost this migration exists to remove.
    with capped as materialized (
      select ev.id, ev.proximity_code, ev.employee_id, ev.scanner_id,
             ev.result, ev.scanned_at
      from (
        -- Filtered per branch so each can walk its own scanned_at DESC
        -- index; with both children ordered the planner can merge-append
        -- and stop at the limit rather than sorting all of history.
        select se.id, se.proximity_code, se.employee_id, se.scanner_id,
               se.result, se.scanned_at
        from public.scan_events se
        where (p_from is null or se.scanned_at >= p_from)
          and (p_to is null or se.scanned_at <= p_to)
        union all
        select sa.id, sa.proximity_code, sa.employee_id, sa.scanner_id,
               sa.result, sa.scanned_at
        from public.scan_events_archive sa
        where (p_from is null or sa.scanned_at >= p_from)
          and (p_to is null or sa.scanned_at <= p_to)
      ) ev
      order by ev.scanned_at desc
      limit 100000
    ),
    -- One pass over scan_logs for the employees actually in the result,
    -- producing a set the final select hash-joins against.
    --
    -- KEYED ON (employee_id, scan_id), not scan_id alone. The old subquery
    -- read `e.scan_logs` — that row's OWN employee's array — so a scan_id
    -- appearing in two employees' logs resolved to the scanning employee's
    -- entry. Keying globally would let the other employee's entry win and
    -- flip an IN to an OUT. It should never happen (a scan_id is a
    -- scan_events primary key, logged against exactly one employee), but
    -- "should never" is not the standard for a rewrite claiming identical
    -- results.
    --
    -- DISTINCT ON reproduces the old `limit 1`: one row per key even if an
    -- array carried a duplicate. Without it a duplicate entry would multiply
    -- rows in the export, which a scalar subquery could never do.
    directions as (
      select distinct on (e.id, l.elem ->> 'scan_id')
             e.id as employee_id,
             (l.elem ->> 'scan_id') as scan_id,
             (l.elem ->> 'direction') as direction
      from public.employees e
      cross join lateral jsonb_array_elements(e.scan_logs) as l(elem)
      where e.id in (select c.employee_id from capped c where c.employee_id is not null)
      order by e.id, (l.elem ->> 'scan_id')
    )
    -- A scan with no employee (unmatched card) joins to nothing here and
    -- gets a null direction, exactly as the old correlated subquery did when
    -- the left join produced a null e.
    select c.scanned_at, e.full_name, e.department, c.proximity_code,
           c.scanner_id, c.result, d.direction
    from capped c
    left join public.employees e on e.id = c.employee_id
    left join directions d
           on d.employee_id = c.employee_id
          and d.scan_id = c.id::text
    order by c.scanned_at desc;
end;
$function$;

COMMENT ON FUNCTION public.get_all_scan_events(timestamptz, timestamptz) IS
  -- No `--` inside this string. It is a literal, so Postgres reads it fine,
  -- but migration-conventions.test.mjs and scan-log-export.test.mjs both
  -- strip `--` to end-of-line before matching, and a dash in here leaves them
  -- holding an unterminated quote.
  'Admin/manager "Export all scan logs" over scan_events + scan_events_archive. Direction is resolved by one pass over employees.scan_logs, NOT a per-row correlated subquery; see 20261106140000 for why that timed out. Capped at 100,000 rows, applied before the direction join.';

-- Grants restated rather than assumed: a CREATE OR REPLACE keeps the
-- existing ACL, but stating it here means the file describes the whole
-- reachable surface of the function rather than half of it.
REVOKE ALL ON FUNCTION public.get_all_scan_events(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_all_scan_events(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_scan_events(timestamptz, timestamptz) TO authenticated;

-- The signature is unchanged, so PostgREST's cached one still resolves and
-- this reload is not strictly load-bearing here. Kept anyway: the convention
-- is "a migration that touches a function reloads the cache", and a reader
-- should not have to re-derive the signature-comparison argument to know
-- why one file skipped it. test/migration-conventions.test.mjs guards it.
NOTIFY pgrst, 'reload schema';
