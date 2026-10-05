-- Settings -> Usage panel: the database half.
--
-- Of the five figures the panel shows (Log Ingestion, Egress, Database size,
-- Log Query, Cached Egress), exactly ONE is knowable from inside the database.
-- The other four are platform billing metrics that live only in Supabase's
-- Management API and are fetched by the `project-usage` Edge Function, which
-- holds the access token the API requires. That token is an account-wide
-- credential and must never reach the browser — see that function's README.
--
-- Database size is also the only one of the five that is a LEVEL rather than a
-- flow: egress and log ingestion accumulate over a billing cycle and reset at
-- the boundary, while database size is simply how big the database is right
-- now. The client therefore shows no "per day" or "projected" figure for it —
-- averaging a level over elapsed days would be meaningless.
--
-- The per-table breakdown is the actionable part. "Database size: 50 MB" tells
-- an admin nothing they can act on; "scan_events is 38 MB of it" points
-- straight at the archival job in this same Settings page.

CREATE FUNCTION public.get_database_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tables jsonb;
BEGIN
  -- Admin only, deliberately stricter than the can_view_settings() gate the
  -- sibling Settings panels use. Its only caller is the Usage panel, which is
  -- already admin-only, so a looser gate here would buy nothing and would let
  -- a Viewer-with-Settings-access read table sizes and row counts by calling
  -- the RPC directly. Least privilege, at zero cost.
  --
  -- SECURITY DEFINER because pg_database_size / pg_total_relation_size read
  -- catalog state the application roles are not granted; this check is what
  -- authorizes the call, not the caller's own privileges.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted to view database usage';
  END IF;

  SELECT coalesce(jsonb_agg(t ORDER BY (t ->> 'total_bytes')::bigint DESC), '[]'::jsonb)
    INTO v_tables
    FROM (
      SELECT jsonb_build_object(
               'name', c.relname,
               'total_bytes', pg_total_relation_size(c.oid),
               'table_bytes', pg_table_size(c.oid),
               'index_bytes', pg_indexes_size(c.oid),
               'live_rows', c.reltuples::bigint
             ) AS t
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 10
    ) s;

  RETURN jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    -- Free plan ceiling, stated here so the UI has something to show a
    -- percentage against. The Management API does not report this per-project,
    -- and hard-coding it in the client would put the same constant in two
    -- places. Update on a plan change.
    'database_limit_bytes', 524288000,  -- 500 MB
    'tables', v_tables,
    'measured_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_database_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_database_usage() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_database_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_usage() TO service_role;
