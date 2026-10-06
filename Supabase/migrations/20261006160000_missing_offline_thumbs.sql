-- Finding employees who have a Drive photo but no kiosk thumbnail.
--
-- Employee Manager reads photo_url (a live Drive link); the kiosk reads
-- photo_thumb_b64. An employee with photo_file_id set and photo_thumb_b64 NULL
-- therefore looks correct in Employee Manager and shows initials on every kiosk,
-- because get_scanner_offline_photo_updates filters on photo_thumb_b64 IS NOT
-- NULL and never sends them at all.
--
-- They get that way when the client could not produce a thumbnail (HEIC is not
-- canvas-decodable) and upload-employee-photo's fallback Drive fetch also failed
-- inside its 2.5s budget — Drive's thumbnail generation routinely lags a file it
-- has only just received. That fallback logs a warning, returns null, and never
-- retries, so the gap is permanent until something repairs it.
--
-- Repair is the Edge Function's `backfill_thumb` action, which re-runs that
-- fetch now that Drive has had time, and writes the row itself. These two
-- functions only identify the work; they move no photo bytes.

CREATE OR REPLACE FUNCTION public.get_offline_thumb_stats(
  p_over_target_bytes integer DEFAULT 12288
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_over integer := greatest(coalesce(p_over_target_bytes, 12288), 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to view offline thumbnail stats';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'employees', count(*),
      'with_thumb', count(e.photo_thumb_b64),
      'total_bytes', coalesce(sum(octet_length(e.photo_thumb_b64)), 0),
      'avg_bytes', coalesce(round(avg(octet_length(e.photo_thumb_b64)))::bigint, 0),
      'max_bytes', coalesce(max(octet_length(e.photo_thumb_b64)), 0),
      'over_target_bytes', v_over,
      'over_target_rows', count(*) FILTER (WHERE octet_length(e.photo_thumb_b64) > v_over),
      'over_target_total_bytes', coalesce(
        sum(octet_length(e.photo_thumb_b64)) FILTER (WHERE octet_length(e.photo_thumb_b64) > v_over), 0),
      -- Added 2026-10-06. Employees invisible on every kiosk despite having a
      -- photo. Distinct from an employee with no photo at all, who correctly
      -- shows initials everywhere and needs no repair.
      'missing_thumb_rows', count(*) FILTER (
        WHERE e.photo_file_id IS NOT NULL AND e.photo_thumb_b64 IS NULL),
      'no_photo_rows', count(*) FILTER (WHERE e.photo_file_id IS NULL),
      'measured_at', now()
    )
    FROM public.employees e
  );
END;
$function$;

COMMENT ON FUNCTION public.get_offline_thumb_stats(integer) IS
  'Admin-only. Size distribution of employees.photo_thumb_b64 in stored (base64) bytes, how many rows exceed p_over_target_bytes, and how many have a Drive photo but no kiosk thumbnail at all. Feeds Settings -> Offline scanner thumbnails.';


-- One keyset page of employees needing repair. Returns NO photo bytes — id and
-- name only — because the whole point of the backfill is that the thumbnail
-- never crosses to the browser. The caller passes each id back to the Edge
-- Function, which does the fetching and the writing server-side.
--
-- SECURITY INVOKER, like get_thumbs_to_recompress: it returns employee rows, so
-- it stays subject to the caller's own RLS rather than bypassing it.
CREATE OR REPLACE FUNCTION public.get_employees_missing_thumb(
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to repair offline thumbnails';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id,
             'full_name', s.full_name,
             'employee_code', s.employee_code
           ) ORDER BY s.id), '[]'::jsonb)
    FROM (
      SELECT e.id, e.full_name, e.employee_code
        FROM public.employees e
       WHERE e.photo_file_id IS NOT NULL
         AND e.photo_thumb_b64 IS NULL
         AND (p_after_id IS NULL OR e.id > p_after_id)
       ORDER BY e.id
       LIMIT v_limit
    ) s
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_employees_missing_thumb(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employees_missing_thumb(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employees_missing_thumb(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employees_missing_thumb(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.get_employees_missing_thumb(uuid, integer) IS
  'Admin-only, SECURITY INVOKER (RLS applies). One keyset page of employees with a Drive photo but no photo_thumb_b64, as id/name only. Each id is passed to upload-employee-photo''s backfill_thumb action, which fetches and writes the thumbnail server-side.';
