-- Postgres logs are filling with:
--
--   23505 duplicate key value violates unique constraint "scan_events_request_id_key"
--
-- in bursts -- 11 in one minute at 08:31, more at 09:04 and 09:16. Nothing is
-- broken. This is 20261023070023's idempotency working exactly as designed,
-- and announcing it as an error every single time.
--
-- THE CHAIN, end to end:
--
--   1. StandaloneScanner.js mints a request_id and calls this function.
--   2. The response does not arrive within ONLINE_SCAN_TIMEOUT_MS (4s), so
--      the kiosk gives up and takes the offline path. The request is STILL IN
--      FLIGHT and goes on to commit -- the client says so itself: "Swallow
--      the still-in-flight request's eventual rejection; we have already
--      committed to the offline path."
--   3. The same scan is queued, with the SAME request_id.
--   4. flushQueue() replays it. scan_events already holds that request_id, so
--      the INSERT hits the partial unique index and raises 23505.
--   5. The client treats 23505 as success (isDuplicateScanRequestError) and
--      drops the queue entry. Correct, and the data is right: no second
--      scan_logs entry, no flipped IN/OUT parity.
--
-- So the ONLY damage is the error itself. It is raised uncaught, which means
-- Postgres writes an ERROR line for every replay. On a free plan already past
-- its log-ingestion grace period that is a real cost, and a dashboard full of
-- red reads as an incident when it is a no-op.
--
-- THE FIX: look before inserting. If this request_id already produced a scan,
-- return what it produced and never reach the INSERT. A replay then costs one
-- indexed lookup and returns the ORIGINAL answer, which is what idempotent is
-- supposed to mean -- the first version only guaranteed the duplicate did not
-- take effect, not that asking twice was safe.
--
-- WHAT THIS DOES NOT FIX, said plainly: every one of these lines means a scan
-- that took longer than 4 seconds and succeeded anyway. That is worth knowing,
-- and after this change the log stops telling you. The count of replays is the
-- signal; the response now carries `duplicate: true` so a caller can see one.
--
-- scan_proximity_code() itself is NOT touched. Its live body is known to be
-- ahead of this repo (see README), so the INSERT cannot be given an ON
-- CONFLICT clause from here without overwriting a definition nobody can read.
-- That is the only way to make the rare concurrent case silent too; see the
-- exception handler below for what is done instead.

-- Reconstructs what a given request_id already answered.
--
-- SECURITY DEFINER, unlike its caller. scan_proximity_code_compact() is
-- SECURITY INVOKER and must stay that way, but a kiosk account cannot SELECT
-- public.employees directly (see README's note on views running under the
-- invoker's RLS) -- so an invoker-rights lookup would find nothing, fall
-- through to the INSERT, and raise the very error this removes.
--
-- It exposes nothing new: gated on the same is_admin() OR can_view_scanner()
-- that scan_events' own SELECT policy uses, and it returns exactly the fields
-- a successful scan of that card already returns to the same caller. A caller
-- must also know the request_id, which they generated.
CREATE OR REPLACE FUNCTION public.prior_scan_for_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_scan record;
  v_direction text;
  v_employee jsonb;
begin
  if p_request_id is null then
    return null;
  end if;
  if not (public.is_admin() or public.can_view_scanner()) then
    return null;
  end if;

  -- Uses scan_events_request_id_key (20261023070023), the same partial index
  -- the INSERT would have collided with.
  select se.id, se.result, se.scanned_at, se.employee_id
    into v_scan
  from public.scan_events se
  where se.raw_payload ->> 'request_id' = p_request_id::text
  limit 1;

  if not found then
    return null;
  end if;

  if v_scan.employee_id is not null then
    -- The ORIGINAL direction, read back rather than recomputed. Recomputing
    -- would give the opposite answer: direction comes from scan_logs's length,
    -- and the first call already incremented it.
    --
    -- Yes, this is the correlated jsonb_array_elements shape that
    -- 20261106140000 removed from the export. There it ran once per exported
    -- row and went quadratic. Here it runs once, for one employee, per replay
    -- -- bounded, like get_scan_feed()'s own copy.
    select l.elem ->> 'direction'
      into v_direction
    from public.employees e
    cross join lateral jsonb_array_elements(e.scan_logs) as l(elem)
    where e.id = v_scan.employee_id
      and l.elem ->> 'scan_id' = v_scan.id::text
    limit 1;

    -- Raw remarks_log and photo_thumb_b64 on purpose: the caller's existing
    -- projection block filters resolved remarks and drops the thumbnail unless
    -- p_include_photo. Building the final shape here would duplicate that
    -- logic and let the two drift.
    select jsonb_build_object(
             'id', e.id,
             'employee_code', e.employee_code,
             'full_name', e.full_name,
             'department', e.department,
             'position', e."position",
             'status', e.status,
             'photo_url', e.photo_url,
             'photo_file_id', e.photo_file_id,
             'photo_thumb_b64', e.photo_thumb_b64,
             'remarks_log', e.remarks_log
           )
      into v_employee
    from public.employees e
    where e.id = v_scan.employee_id;
  end if;

  return jsonb_build_object(
    'result', v_scan.result,
    'direction', v_direction,
    -- Explicit JSON null rather than SQL NULL: jsonb_typeof(null) is 'null',
    -- which the caller's projection block correctly skips. An SQL NULL here
    -- would make the whole object null instead.
    'employee', coalesce(v_employee, 'null'::jsonb),
    'scanned_at', v_scan.scanned_at,
    'duplicate', true
  );
end;
$function$;

COMMENT ON FUNCTION public.prior_scan_for_request(uuid) IS
  'Returns the response a given request_id already produced, or null. Lets scan_proximity_code_compact() answer a replay without reaching the INSERT that would raise 23505 on scan_events_request_id_key. See 20261106170000.';

-- Signature, language, volatility and SECURITY INVOKER all byte-identical to
-- 20261023070023, so this is a true CREATE OR REPLACE: no DROP, no stale
-- overload, and no client change. The projection block below is unchanged
-- from that file.
CREATE OR REPLACE FUNCTION public.scan_proximity_code_compact(
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
  v_scanned_at := coalesce(p_scanned_at, now());

  -- Has this exact request already been answered? One indexed lookup, and
  -- null for every first-time scan, which is nearly all of them.
  v_result := public.prior_scan_for_request(p_request_id);

  IF v_result IS NOT NULL THEN
    -- The original scan's timestamp, not this replay's. The replay is a
    -- re-reading of a past event, not a new one.
    v_scanned_at := coalesce((v_result ->> 'scanned_at')::timestamptz, v_scanned_at);
  ELSE
    BEGIN
      PERFORM set_config('app.scan_request_id', coalesce(p_request_id::text, ''), true);
      v_result := public.scan_proximity_code(
        p_proximity_code, p_scanner_id, v_scanned_at, p_offline
      );
    EXCEPTION WHEN unique_violation THEN
      -- The narrow race the lookup above cannot close: the original request
      -- was still in flight when this one checked, and committed before this
      -- one inserted. Entirely plausible here, since that is the same 4-second
      -- overlap that creates the replay in the first place.
      --
      -- By the time a unique violation is raised the other transaction has
      -- necessarily committed -- that is what releases the index wait -- so
      -- the row is visible now even though it was not a moment ago.
      --
      -- This path is still logged by Postgres; a caught exception does not
      -- unwrite the ERROR line. Only ON CONFLICT inside the INSERT would, and
      -- that INSERT lives in scan_proximity_code(), whose live body this repo
      -- cannot see. Rare by construction, where the replay case was constant.
      v_result := public.prior_scan_for_request(p_request_id);
      IF v_result IS NULL THEN
        -- A unique violation this function cannot explain is a real fault.
        RAISE;
      END IF;
      v_scanned_at := coalesce((v_result ->> 'scanned_at')::timestamptz, v_scanned_at);
    END;
  END IF;

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

REVOKE ALL ON FUNCTION public.prior_scan_for_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prior_scan_for_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.prior_scan_for_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prior_scan_for_request(uuid) TO service_role;

-- prior_scan_for_request() is new, so PostgREST would answer it from its
-- in-memory cache with PGRST202 until that cache happened to refresh -- and it
-- is called from inside another function, so the failure would surface as
-- every scan breaking rather than as one missing RPC.
-- test/migration-conventions.test.mjs guards this.
NOTIFY pgrst, 'reload schema';
