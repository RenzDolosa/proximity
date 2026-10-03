-- Scan payload pass 2: stop shipping employee thumbnails and unused PII on
-- every scan / feed refresh. The kiosk already holds thumbnails locally
-- (get_scanner_offline_photo_updates), so the live responses only need to
-- identify the employee.
--
-- Applied live as migration version 20261003083051 (scan_payload_photo_split).
-- Backward compatible: p_include_photo defaults to true, get_scan_feed() is
-- untouched, so clients deployed before this change keep working.

-- 1. scan_proximity_code_compact: explicit employee allowlist + optional photo.
--    Adding a parameter changes the signature, so the old function must be
--    dropped in the same transaction (otherwise Postgres keeps both overloads
--    and the new one inherits PUBLIC execute by default).
DROP FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean);

CREATE FUNCTION public.scan_proximity_code_compact(
  p_proximity_code text,
  p_scanner_id text DEFAULT 'default-scanner'::text,
  p_scanned_at timestamp with time zone DEFAULT now(),
  p_offline boolean DEFAULT false,
  p_include_photo boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_employee jsonb;
  v_scanned_at timestamptz;
BEGIN
  v_scanned_at := coalesce(p_scanned_at, now());
  v_result := public.scan_proximity_code(
    p_proximity_code, p_scanner_id, v_scanned_at, p_offline
  );
  v_employee := v_result -> 'employee';

  IF jsonb_typeof(v_employee) = 'object' THEN
    -- Allowlist, not a denylist: new employees columns never leak into the
    -- scanner response by default (email, phone, audit columns, scan_logs...).
    v_employee := jsonb_build_object(
      'id', v_employee -> 'id',
      'employee_code', v_employee -> 'employee_code',
      'full_name', v_employee -> 'full_name',
      'department', v_employee -> 'department',
      'position', v_employee -> 'position',
      'status', v_employee -> 'status',
      'photo_url', v_employee -> 'photo_url',
      'photo_file_id', v_employee -> 'photo_file_id',
      'remarks_log',
      (
        SELECT coalesce(jsonb_agg(r.value ORDER BY r.ordinality), '[]'::jsonb)
        FROM jsonb_array_elements(coalesce(v_employee -> 'remarks_log', '[]'::jsonb))
          WITH ORDINALITY AS r(value, ordinality)
        WHERE r.value ->> 'resolved' IS DISTINCT FROM 'true'
      )
    );
    IF p_include_photo THEN
      v_employee := v_employee || jsonb_build_object(
        'photo_thumb_b64',
        (v_result -> 'employee') -> 'photo_thumb_b64'
      );
    END IF;
    v_result := jsonb_set(v_result, '{employee}', v_employee);
  END IF;

  RETURN v_result || jsonb_build_object('scanned_at', v_scanned_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean) TO service_role;

-- 2. get_scan_feed_compact: the Recent Activity list renders name, scanner,
--    result, time and direction only. No thumbnails, no proximity codes, and a
--    clamped row count. get_scan_feed() stays in place for already-deployed
--    clients and is dropped in a follow-up migration once they are gone.
CREATE FUNCTION public.get_scan_feed_compact(
  p_limit integer DEFAULT 10,
  p_scanner_id text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  scanner_id text,
  result text,
  scanned_at timestamp with time zone,
  employee_id uuid,
  employee_name text,
  direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.can_view_scanner()) THEN
    RAISE EXCEPTION 'not permitted to view the scan feed';
  END IF;

  RETURN QUERY
    SELECT se.id, se.scanner_id, se.result, se.scanned_at,
           e.id, e.full_name,
           (
             SELECT elem ->> 'direction'
             FROM jsonb_array_elements(e.scan_logs) AS elem
             WHERE elem ->> 'scan_id' = se.id::text
             LIMIT 1
           )
    FROM public.scan_events se
    LEFT JOIN public.employees e ON e.id = se.employee_id
    WHERE p_scanner_id IS NULL OR se.scanner_id = p_scanner_id
    ORDER BY se.scanned_at DESC
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 100);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_scan_feed_compact(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_feed_compact(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_feed_compact(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_feed_compact(integer, text) TO service_role;
