-- Egress pass 3: stop re-sending data that did not change.
--
-- Passes 1 and 2 (20261003025504, 20261003083051) shrank the *per-scan* and
-- *per-feed* payloads. What they explicitly left open is the dominant cost:
-- two unconditional whole-dataset downloads that run on a timer whether or
-- not anything actually changed.
--
--   get_scanner_offline_cache_compact()  — every 5 min per kiosk, the entire
--     card roster (729 employees, ~0.6 KB each ≈ 430 KB per call). 288 calls
--     a day is ~125 MB/day *per kiosk*, ~3.7 GB over a billing cycle, almost
--     all of it bytes the kiosk already had.
--   get_dashboard_stats() + get_onsite_roster() — every 30 s per open
--     Dashboard tab, and the stats object embeds an on_site[] array that is
--     a second copy of the roster the page never reads (it derives all of
--     its on-site numbers from get_onsite_roster() via summarizeRoster()).
--
-- This migration adds the two read paths that make both conditional. Nothing
-- existing is dropped or altered: the previous RPCs stay exactly as they are
-- so an already-deployed client keeps working, and the new client falls back
-- to them if this file has not been applied yet.

-- 1. Incremental scanner lookup cache.
--
-- Two different change signals, because the underlying tables give us two
-- different kinds of change:
--
--   * employees has updated_at, maintained by trg_employees_updated_at, and
--     every scan UPDATEs the employee row (trg_append_scan_log bumps
--     scan_parity_count) — so "which employees changed since <cursor>" is an
--     exact, cheap question. In a 5-minute window that is the handful of
--     people who actually scanned, not all 729.
--   * proximity_cards has NO updated_at, and the row set itself can change
--     (a card issued, deleted, revoked, or reassigned to someone else).
--     Those are rare and none of them is expressible as a timestamp cursor,
--     so they are covered by a digest over card identity + activity +
--     assignment. A digest mismatch forces one full resync, which is both
--     correct and cheap at the rate cards actually change.
--
-- Deletions therefore need no separate "removed" list the way
-- get_scanner_offline_photo_updates() does: anything that removes or
-- renames a row necessarily changes the digest, and the client replaces its
-- whole cache on a full response.
CREATE FUNCTION public.get_scanner_offline_cache_delta(
  p_since timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_known_digest text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digest text;
  v_full boolean;
  v_cursor timestamptz;
  v_rows jsonb;
BEGIN
  -- Same gate as get_scanner_offline_cache(), which this replaces on the
  -- kiosk's refresh path. SECURITY DEFINER for the same reason that one is:
  -- the scanner account is not required to have row-level read access to
  -- employees, only permission to use the scanner.
  IF NOT (public.is_admin() OR public.can_view_scanner()) THEN
    RAISE EXCEPTION 'not permitted to use the scanner';
  END IF;

  SELECT md5(coalesce(string_agg(
           pc.id::text || '|' || pc.proximity_code || '|' || pc.is_active::text
             || '|' || coalesce(e.id::text, ''),
           ',' ORDER BY pc.id), ''))
    INTO v_digest
    FROM public.proximity_cards pc
    LEFT JOIN public.employees e ON e.proximity_card_id = pc.id;

  v_full := p_since IS NULL
         OR p_known_digest IS NULL
         OR p_known_digest IS DISTINCT FROM v_digest;

  -- The cursor handed back is deliberately a minute behind now(): a scan
  -- commits the employees UPDATE and this query reads a snapshot, so a row
  -- written by a transaction that was still in flight when this response was
  -- built can carry an updated_at just *below* the cursor it would otherwise
  -- be compared against, and would then never be picked up by any later
  -- delta. Re-sending one minute of overlap costs a few rows per call;
  -- missing a row would leave the kiosk classifying against stale card or
  -- employee status until something forced a full resync.
  v_cursor := now() - interval '1 minute';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'proximity_code', pc.proximity_code,
    'card_active', pc.is_active,
    'employee_id', e.id,
    'full_name', e.full_name,
    'employee_code', e.employee_code,
    'department', e.department,
    'position', e.position,
    'updated_at', e.updated_at,
    'employee_status', e.status,
    -- Same wire name and same source column as
    -- get_scanner_offline_cache()'s scan_count — see
    -- 20261001040000_scan_logs_parity_counter.sql. JS/Core/offlineScanning.js
    -- consumes this field directly for its IN/OUT parity arithmetic, so the
    -- delta rows have to be byte-shape-identical to the full ones.
    'scan_count', e.scan_parity_count,
    -- Unresolved remarks only, matching get_scanner_offline_cache_compact().
    'remarks_log', coalesce((
      SELECT jsonb_agg(r.value ORDER BY r.ordinality)
      FROM jsonb_array_elements(coalesce(e.remarks_log, '[]'::jsonb))
        WITH ORDINALITY AS r(value, ordinality)
      WHERE r.value ->> 'resolved' IS DISTINCT FROM 'true'
    ), '[]'::jsonb)
  )), '[]'::jsonb)
    INTO v_rows
    FROM public.proximity_cards pc
    LEFT JOIN public.employees e ON e.proximity_card_id = pc.id
    -- An unassigned card (e IS NULL) can only change through its digest
    -- inputs, so it is correct for the incremental branch to skip it: any
    -- such change already forced v_full above.
   WHERE v_full OR e.updated_at > p_since;

  RETURN jsonb_build_object(
    'full', v_full,
    'digest', v_digest,
    'cursor', v_cursor,
    'rows', v_rows
  );
END;
$function$;

-- 2. Dashboard pulse: the small, frequent half of the Dashboard's refresh.
--
-- Returns the stats the page actually paints, minus the two array fields it
-- never reads (`on_site`, which duplicates the roster, and `by_department`,
-- which the page recomputes from the roster in summarizeRoster()), plus a
-- cheap version string for the roster so the client can skip downloading an
-- unchanged one.
--
-- Why employees' count + max(updated_at) is a sound roster version:
-- get_onsite_roster() is derived entirely from employees (last scan_logs
-- entry + status), and every path that can change it — a scan, a status
-- change, an added or deleted employee — either writes an employees row
-- (trg_employees_updated_at maintains updated_at on every UPDATE) or changes
-- the row count. The one thing it cannot see is `is_stale` flipping purely
-- with the passage of time, which is why the client also force-refreshes the
-- roster on a slow timer regardless of this value.
--
-- SECURITY INVOKER: both wrapped functions run their own gate
-- (get_dashboard_stats: admin or Employee Manager scope), and the version
-- subquery reads employees under the caller's own RLS.
CREATE FUNCTION public.get_dashboard_pulse(
  p_window_hours integer DEFAULT 16
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'stats', public.get_dashboard_stats(p_window_hours) - 'on_site' - 'by_department',
    'roster_version', (
      SELECT md5(count(*)::text || ':' || coalesce(max(e.updated_at), 'epoch'::timestamptz)::text)
      FROM public.employees e
    )
  );
$function$;

-- Grants. Both REVOKE FROM PUBLIC *and* FROM anon: Supabase's default
-- privileges grant anon execute directly, so revoking PUBLIC alone leaves a
-- SECURITY DEFINER function anonymously callable (see
-- 20261003083312_revoke_proximity_card_revoke_anon.sql for the last time
-- that was missed).
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache_delta(timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache_delta(timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache_delta(timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache_delta(timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_dashboard_pulse(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_pulse(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_pulse(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_pulse(integer) TO service_role;

-- Supporting index for the incremental branch's only filter. 729 rows seq
-- scan fine today; this keeps the 5-minute-per-kiosk query cheap as the
-- roster grows, and costs one extra index write per scan (which already
-- writes the row).
CREATE INDEX IF NOT EXISTS employees_updated_at_idx ON public.employees (updated_at);
