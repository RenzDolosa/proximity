-- Keep scanner responses compact without replacing the live RPCs that own
-- scan classification, scanner enablement, authorization, and persistence.

CREATE FUNCTION public.scan_proximity_code_compact(
  p_proximity_code text,
  p_scanner_id text DEFAULT 'default-scanner'::text,
  p_scanned_at timestamp with time zone DEFAULT now(),
  p_offline boolean DEFAULT false
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
    v_employee := (v_employee - 'scan_logs' - 'remarks_log')
      || jsonb_build_object(
        'remarks_log',
        (
          SELECT coalesce(jsonb_agg(r.value ORDER BY r.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(coalesce(v_employee -> 'remarks_log', '[]'::jsonb))
            WITH ORDINALITY AS r(value, ordinality)
          WHERE r.value ->> 'resolved' IS DISTINCT FROM 'true'
        )
      );
    v_result := jsonb_set(v_result, '{employee}', v_employee);
  END IF;

  RETURN v_result || jsonb_build_object('scanned_at', v_scanned_at);
END;
$function$;

CREATE FUNCTION public.test_scan_proximity_code_compact(p_proximity_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_employee jsonb;
  v_prior_count integer;
  v_direction text;
BEGIN
  v_result := public.test_scan_proximity_code(p_proximity_code);
  v_employee := v_result -> 'employee';

  IF jsonb_typeof(v_employee) = 'object' THEN
    IF v_employee ? 'scan_parity_count' THEN
      v_prior_count := coalesce((v_employee ->> 'scan_parity_count')::integer, 0);
      v_direction := CASE WHEN v_prior_count % 2 = 0 THEN 'in' ELSE 'out' END;
      v_result := jsonb_set(v_result, '{direction}', to_jsonb(v_direction), true);
    END IF;

    v_employee := (v_employee - 'scan_logs' - 'remarks_log')
      || jsonb_build_object(
        'remarks_log',
        (
          SELECT coalesce(jsonb_agg(r.value ORDER BY r.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(coalesce(v_employee -> 'remarks_log', '[]'::jsonb))
            WITH ORDINALITY AS r(value, ordinality)
          WHERE r.value ->> 'resolved' IS DISTINCT FROM 'true'
        )
      );
    v_result := jsonb_set(v_result, '{employee}', v_employee);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.get_scanner_offline_cache_compact()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  v_rows := public.get_scanner_offline_cache();

  RETURN (
    SELECT coalesce(jsonb_agg(
      (row_data.value - 'remarks_log')
      || jsonb_build_object(
        'remarks_log',
        coalesce((
          SELECT jsonb_agg(r.value ORDER BY r.ordinality)
          FROM jsonb_array_elements(coalesce(row_data.value -> 'remarks_log', '[]'::jsonb))
            WITH ORDINALITY AS r(value, ordinality)
          WHERE r.value ->> 'resolved' IS DISTINCT FROM 'true'
        ), '[]'::jsonb)
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) AS row_data(value)
  );
END;
$function$;

CREATE FUNCTION public.get_scanner_offline_photo_updates(
  p_known_photo_ids jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_known jsonb := coalesce(p_known_photo_ids, '{}'::jsonb);
BEGIN
  IF NOT (public.is_admin() OR public.can_view_scanner()) THEN
    RAISE EXCEPTION 'not permitted to use the scanner';
  END IF;
  IF jsonb_typeof(v_known) <> 'object' THEN
    RAISE EXCEPTION 'known photo ids must be a JSON object';
  END IF;

  RETURN jsonb_build_object(
    'photos',
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'employee_id', e.id,
        'photo_file_id', e.photo_file_id,
        'photo_thumb_b64', e.photo_thumb_b64
      ) ORDER BY e.id), '[]'::jsonb)
      FROM public.employees e
      WHERE e.photo_thumb_b64 IS NOT NULL
        AND (
          NOT (v_known ? e.id::text)
          OR (v_known ->> e.id::text) IS DISTINCT FROM e.photo_file_id
        )
    ),
    'removed',
    (
      SELECT coalesce(jsonb_agg(k.key ORDER BY k.key), '[]'::jsonb)
      FROM jsonb_each_text(v_known) AS k(key, photo_file_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.id::text = k.key
          AND e.photo_thumb_b64 IS NOT NULL
      )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.test_scan_proximity_code_compact(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_scan_proximity_code_compact(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.test_scan_proximity_code_compact(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_scan_proximity_code_compact(text) TO service_role;

REVOKE ALL ON FUNCTION public.get_scanner_offline_cache_compact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache_compact() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache_compact() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache_compact() TO service_role;

REVOKE ALL ON FUNCTION public.get_scanner_offline_photo_updates(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_photo_updates(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_photo_updates(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_photo_updates(jsonb) TO service_role;
