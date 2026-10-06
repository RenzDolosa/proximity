-- Offline-thumbnail size reporting, for Settings -> Employee photos ->
-- "Recompress offline thumbnails".
--
-- Why an RPC rather than letting the panel add up what it downloads: the
-- whole point of that panel is that employees.photo_thumb_b64 is the
-- heaviest thing in this database (12.5 MB of a 500 MB ceiling across 729
-- rows on 2026-10-05, and the single largest payload the kiosk offline
-- cache pulls down — see get_scanner_offline_photo_updates). Measuring it
-- by fetching all of it would spend the exact resource the panel exists to
-- conserve. This answers "is there anything to gain here?" in a few hundred
-- bytes, so the expensive pass only runs when the answer is yes.
--
-- `over_target_rows` is the actionable figure. Rows at or under
-- over_target_bytes were already produced at (or below) the current client
-- target and will be left alone by the recompressor — see
-- pickSmallerThumb() in JS/Utils/image.js, which keeps the original
-- whenever re-encoding does not save at least 10%. A run that reports zero
-- over-target rows has nothing to do, and the panel says so instead of
-- walking the whole roster to discover it.
--
-- octet_length() here is the width of the base64 TEXT, which is what the
-- column and therefore the database and every response actually carry.
-- That is deliberately NOT the decoded image size (~3/4 of it): the client
-- reports decoded bytes via base64ByteLength(), because that is what the
-- encoder controls, while this reports stored bytes, because that is what
-- is being paid for. Both numbers are correct for their own question; the
-- panel labels which is which.

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
  -- Admin only, matching get_database_usage()'s gate rather than the looser
  -- can_view_settings() the sounds/photos panels use. The action this feeds
  -- rewrites every employee row; the figure that justifies running it is
  -- held to the same bar.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to view offline thumbnail stats';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'employees', count(*),
      'with_thumb', count(e.photo_thumb_b64),
      -- coalesce so an empty roster reports an honest 0 rather than null,
      -- which the client would render as "unknown".
      'total_bytes', coalesce(sum(octet_length(e.photo_thumb_b64)), 0),
      'avg_bytes', coalesce(round(avg(octet_length(e.photo_thumb_b64)))::bigint, 0),
      'max_bytes', coalesce(max(octet_length(e.photo_thumb_b64)), 0),
      'over_target_bytes', v_over,
      'over_target_rows', count(*) FILTER (WHERE octet_length(e.photo_thumb_b64) > v_over),
      'over_target_total_bytes', coalesce(
        sum(octet_length(e.photo_thumb_b64)) FILTER (WHERE octet_length(e.photo_thumb_b64) > v_over), 0),
      'measured_at', now()
    )
    FROM public.employees e
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_offline_thumb_stats(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_offline_thumb_stats(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_offline_thumb_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_offline_thumb_stats(integer) TO service_role;

COMMENT ON FUNCTION public.get_offline_thumb_stats(integer) IS
  'Admin-only. Size distribution of employees.photo_thumb_b64 in stored (base64) bytes, plus how many rows exceed p_over_target_bytes. Feeds Settings -> Employee photos -> Recompress offline thumbnails, which re-encodes the over-target rows client-side.';


-- One page of thumbnails for the recompressor to re-encode.
--
-- An RPC rather than a PostgREST select because of the size filter: only
-- rows BIGGER than the target are worth downloading, and PostgREST cannot
-- express `octet_length(photo_thumb_b64) > n` as a query parameter. Without
-- the filter the panel would download every thumbnail — including the ones
-- already small enough — purely so the client could decide not to touch
-- them. On this roster that is the difference between fetching the
-- over-target rows and fetching all 12.5 MB.
--
-- Keyset pagination (p_after_id), not OFFSET: the caller UPDATEs rows as it
-- walks, and an offset-based page would shift under its own writes. `id` is
-- the primary key, so > is stable, total, and cannot revisit or skip a row.
--
-- NOT SECURITY DEFINER, unlike its sibling above. This returns employee
-- photo data, so it must be subject to the caller's own RLS
-- (employees_select_scope / can_view_employee_manager) rather than bypass
-- it — a DEFINER function here would hand a scope-limited account the
-- photos of employees it cannot otherwise see. The is_admin() check is on
-- top of RLS, not instead of it.
CREATE OR REPLACE FUNCTION public.get_thumbs_to_recompress(
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_over_target_bytes integer DEFAULT 12288
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Bounded so a caller cannot ask for the whole roster in one response and
  -- undo the paging this exists to provide.
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_over integer := greatest(coalesce(p_over_target_bytes, 12288), 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to recompress offline thumbnails';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id,
             'full_name', s.full_name,
             'photo_thumb_b64', s.photo_thumb_b64
           ) ORDER BY s.id), '[]'::jsonb)
    FROM (
      SELECT e.id, e.full_name, e.photo_thumb_b64
        FROM public.employees e
       WHERE e.photo_thumb_b64 IS NOT NULL
         AND octet_length(e.photo_thumb_b64) > v_over
         AND (p_after_id IS NULL OR e.id > p_after_id)
       ORDER BY e.id
       LIMIT v_limit
    ) s
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_thumbs_to_recompress(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_thumbs_to_recompress(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_thumbs_to_recompress(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_thumbs_to_recompress(uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.get_thumbs_to_recompress(uuid, integer, integer) IS
  'Admin-only, SECURITY INVOKER (RLS applies). One keyset page of employees whose photo_thumb_b64 exceeds p_over_target_bytes, for client-side re-encoding. Paged on id so the caller can UPDATE rows as it walks.';
