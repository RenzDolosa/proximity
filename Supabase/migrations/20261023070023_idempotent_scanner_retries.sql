-- A timed-out online scan may already have committed before the kiosk queues
-- its offline fallback. Replaying that same physical scan must not append a
-- second scan_logs entry or flip IN/OUT parity again.
--
-- Keep the request key inside raw_payload: this adds no scan_events response
-- column and does not change the compact scanner response.
CREATE UNIQUE INDEX scan_events_request_id_key
  ON public.scan_events ((raw_payload ->> 'request_id'))
  WHERE raw_payload ->> 'request_id' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_scan_request_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id text;
BEGIN
  v_request_id := nullif(current_setting('app.scan_request_id', true), '');
  IF v_request_id IS NOT NULL THEN
    NEW.raw_payload := coalesce(NEW.raw_payload, '{}'::jsonb)
      || jsonb_build_object('request_id', v_request_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER scan_events_capture_request_id
BEFORE INSERT ON public.scan_events
FOR EACH ROW
EXECUTE FUNCTION public.capture_scan_request_id();

REVOKE ALL ON FUNCTION public.capture_scan_request_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_scan_request_id() FROM anon;
REVOKE ALL ON FUNCTION public.capture_scan_request_id() FROM authenticated;

-- The RPC signature change is additive for callers: the new UUID parameter is
-- optional, and old clients continue to call this with their existing args.
DROP FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean);

CREATE FUNCTION public.scan_proximity_code_compact(
  p_proximity_code text,
  p_scanner_id text DEFAULT 'default-scanner'::text,
  p_scanned_at timestamp with time zone DEFAULT now(),
  p_offline boolean DEFAULT false,
  p_include_photo boolean DEFAULT true,
  p_request_id uuid DEFAULT NULL
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
  PERFORM set_config('app.scan_request_id', coalesce(p_request_id::text, ''), true);
  v_scanned_at := coalesce(p_scanned_at, now());
  v_result := public.scan_proximity_code(
    p_proximity_code, p_scanner_id, v_scanned_at, p_offline
  );
  v_employee := v_result -> 'employee';

  IF jsonb_typeof(v_employee) = 'object' THEN
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

REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code_compact(text, text, timestamptz, boolean, boolean, uuid) TO service_role;