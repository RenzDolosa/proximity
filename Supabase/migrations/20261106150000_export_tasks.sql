-- Export manager: a ledger of who exported what, plus a paged export RPC so
-- no single statement can time out again.
--
-- 20261106140000 made "Export all scan logs" finish by removing the quadratic
-- direction lookup. This removes the OTHER way it can fail: one statement
-- returning the whole history. However fast that statement is, it is still a
-- single request whose duration grows with the data, and the statement
-- timeout is a wall it will reach again. Pages of 10,000 never approach it.
--
-- IT ALSO FIXES A SILENT TRUNCATION. get_all_scan_events() caps at 100,000
-- rows with no indication that it did. An org past that cap got the newest
-- 100,000 and an .xlsx that looked complete. Paging stops when a page comes
-- back short, so "all" means all.
--
-- WHAT THIS COSTS, since the whole project is built around that question.
-- Egress: unchanged. The same rows cross the wire whether they arrive in one
-- response or eleven; PostgREST gzips either way. Log ingestion: one event
-- per page instead of one per export, plus two for the ledger -- roughly
-- 10-13 events, about 20-26 KB, against a 1 GB monthly allowance. A door scan
-- costs one event too, and there are thousands of those a day.
--
-- NO FILES ARE STORED. The .xlsx is built in the browser and saved to the
-- operator's own disk, exactly as before. This table records that an export
-- happened; it is not a copy of what was exported. "Re-run" repeats the
-- export from its recorded parameters rather than fetching a stored file,
-- because storing files would mean Storage, and every download from Storage
-- is billed egress.

CREATE TABLE public.export_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign key, and a denormalised name, deliberately -- same shape and
  -- same reason as audit_log.actor_id/actor_name. A ledger of who exported
  -- personal attendance data must outlive the account that did it; a
  -- cascading FK would erase exactly the rows an investigation wants.
  user_id uuid,
  operator_name text,
  -- Which export this was. Free text rather than an enum so a second export
  -- (attendance, cards) does not need a migration to add its own value; the
  -- UI's filter reads back whatever is present.
  module text NOT NULL,
  filename text NOT NULL,
  -- Enough to repeat the export. For scan logs that is {from, to}.
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer,
  status text NOT NULL DEFAULT 'running'
    CHECK (status = ANY (ARRAY['running','finished','failed'])),
  detail text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- The listing's default order, and the scoped order a non-admin gets. Two
-- indexes rather than one because the non-admin query filters on user_id
-- first, and a plain started_at index would make it scan everyone's rows to
-- find its own.
CREATE INDEX idx_export_tasks_started_at ON public.export_tasks (started_at DESC);
CREATE INDEX idx_export_tasks_user ON public.export_tasks (user_id, started_at DESC);

COMMENT ON TABLE public.export_tasks IS
  'Ledger of data exports: who, what, when, how many rows. Written only by start_export_task()/finish_export_task(). Holds no exported data and no files; the .xlsx is built in the browser and saved to the operator''s own disk.';

ALTER TABLE public.export_tasks ENABLE ROW LEVEL SECURITY;

-- THE RULE THAT WAS ASKED FOR: an admin sees every task, everyone else sees
-- only their own.
--
-- A policy, not just an RPC filter. get_export_tasks() applies the same scope,
-- but a policy is what holds if anything ever reaches this table through
-- PostgREST directly -- and `user_id = auth.uid()` is the kind of rule that
-- must be true in the database, not merely true in the function everyone
-- currently happens to call.
CREATE POLICY export_tasks_select_scope ON public.export_tasks
  FOR SELECT TO authenticated
  USING (public.is_admin() OR user_id = auth.uid());

-- No INSERT, UPDATE or DELETE policy at all. The two writer functions below
-- are SECURITY DEFINER and bypass RLS the same way every other write path in
-- this schema does. A client that could UPDATE its own rows could rewrite the
-- ledger's history, which would make it worthless as a record.

CREATE OR REPLACE FUNCTION public.start_export_task(
  p_module text,
  p_filename text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  -- Same gate as the export itself. Recording an export nobody is allowed to
  -- run would let any authenticated account write rows into an admin's view.
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to export data';
  end if;

  insert into public.export_tasks (user_id, operator_name, module, filename, params)
  values (
    auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    coalesce(nullif(btrim(p_module), ''), 'unknown'),
    coalesce(nullif(btrim(p_filename), ''), 'export.xlsx'),
    coalesce(p_params, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- Recorded at the START, not only on success, which is the half that makes
-- this a record rather than a receipt. If the browser dies mid-export the row
-- stays 'running' forever -- and that is the honest outcome: the rows really
-- did leave the database, and nothing knows whether they reached a disk.
CREATE OR REPLACE FUNCTION public.finish_export_task(
  p_id uuid,
  p_status text,
  p_row_count integer DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if p_status is distinct from 'finished' and p_status is distinct from 'failed' then
    raise exception 'an export task can only be finished or failed';
  end if;

  -- Scoped to the caller's own running task. Not is_admin_or_manager(): an
  -- admin has no business closing someone else's export, and a row that has
  -- already settled must not be reopened or re-counted. A no-op update when
  -- nothing matches is the correct outcome, not an error -- a browser
  -- retrying a finish it already sent should not see a failure.
  update public.export_tasks
  set status = p_status,
      row_count = p_row_count,
      detail = left(p_detail, 500),
      finished_at = now()
  where id = p_id
    and user_id = auth.uid()
    and status = 'running';
end;
$function$;

-- The listing. Scoped the same way the policy is, so a manager calling this
-- directly sees their own rows and nothing else.
CREATE OR REPLACE FUNCTION public.get_export_tasks(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_module text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id uuid, user_id uuid, operator_name text, module text, filename text,
  params jsonb, row_count integer, status text, detail text,
  started_at timestamptz, finished_at timestamptz, is_mine boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_admin boolean := public.is_admin();
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to view export tasks';
  end if;

  return query
    select t.id, t.user_id, t.operator_name, t.module, t.filename,
           t.params, t.row_count, t.status, t.detail,
           t.started_at, t.finished_at,
           t.user_id is not distinct from auth.uid() as is_mine,
           -- The page total on every row instead of a second count RPC: one
           -- bigint repeated is cheaper than a whole extra request and its
           -- log event.
           count(*) over () as total_count
    from public.export_tasks t
    where (v_admin or t.user_id = auth.uid())
      and (p_module is null or t.module = p_module)
      and (p_from is null or t.started_at >= p_from)
      and (p_to is null or t.started_at <= p_to)
    order by t.started_at desc
    -- 500, not an arbitrary round number: it is the largest option in the
    -- client's page-size selector (Components/Pagination.js PAGE_SIZES).
    -- Clamping BELOW it silently skips rows -- the client would ask for 500,
    -- get 200, then compute the next page's offset as 500 and step straight
    -- over the 300 in between. test/export-manager.test.mjs ties the two
    -- numbers together so they cannot drift apart.
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

-- Keyset-paged scan log export.
--
-- KEYSET, NOT OFFSET. An OFFSET page re-walks and discards every row before
-- it, so page 10 costs ten times page 1 and the last pages of a large export
-- would reach the statement timeout all over again -- the exact failure this
-- is meant to remove. Comparing (scanned_at, id) against the last row of the
-- previous page costs the same on page 1 and page 500.
--
-- `id` is in the output precisely so the client can build that cursor;
-- get_all_scan_events() does not expose it, which is why this is a new
-- function rather than a changed one. Adding a column to a RETURNS TABLE
-- needs DROP then CREATE, and dropping the function the export currently
-- depends on, in the same migration that introduces its replacement, trades a
-- working fallback for tidiness.
--
-- Direction is resolved the same non-quadratic way as 20261106140000, for the
-- same reason. test/scan-log-export.test.mjs asserts BOTH functions keep that
-- shape, so the two cannot drift apart.
CREATE OR REPLACE FUNCTION public.get_scan_events_page(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_after_scanned_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10000
)
RETURNS TABLE(
  id uuid, scanned_at timestamptz, employee_name text, department text,
  proximity_code text, scanner_id text, result text, direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  -- Clamped so a client cannot ask for the whole table in one page and
  -- recreate the timeout by hand.
  v_limit integer := greatest(1, least(coalesce(p_limit, 10000), 25000));
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to export scan history';
  end if;

  return query
    with capped as materialized (
      select ev.id, ev.proximity_code, ev.employee_id, ev.scanner_id,
             ev.result, ev.scanned_at
      from (
        select se.id, se.proximity_code, se.employee_id, se.scanner_id,
               se.result, se.scanned_at
        from public.scan_events se
        where (p_from is null or se.scanned_at >= p_from)
          and (p_to is null or se.scanned_at <= p_to)
          -- Row-wise comparison, not `scanned_at < x or (= x and id < y)`:
          -- the tuple form is what lets the planner use the scanned_at index
          -- as a starting position rather than filtering after the fact.
          and (p_after_scanned_at is null
               or (se.scanned_at, se.id) < (p_after_scanned_at, p_after_id))
        union all
        select sa.id, sa.proximity_code, sa.employee_id, sa.scanner_id,
               sa.result, sa.scanned_at
        from public.scan_events_archive sa
        where (p_from is null or sa.scanned_at >= p_from)
          and (p_to is null or sa.scanned_at <= p_to)
          and (p_after_scanned_at is null
               or (sa.scanned_at, sa.id) < (p_after_scanned_at, p_after_id))
      ) ev
      -- id breaks ties on scanned_at. Without it, two scans sharing a
      -- timestamp could straddle a page boundary in an unstable order and be
      -- silently dropped or duplicated between pages.
      order by ev.scanned_at desc, ev.id desc
      limit v_limit
    ),
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
    select c.id, c.scanned_at, e.full_name, e.department, c.proximity_code,
           c.scanner_id, c.result, d.direction
    from capped c
    left join public.employees e on e.id = c.employee_id
    left join directions d
           on d.employee_id = c.employee_id
          and d.scan_id = c.id::text
    order by c.scanned_at desc, c.id desc;
end;
$function$;

COMMENT ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) IS
  'Keyset-paged "Export all scan logs". Pass the previous page''s last (scanned_at, id) as the cursor; a short page means the end. Replaces get_all_scan_events() for the client, which capped at 100,000 rows without saying so.';

REVOKE ALL ON FUNCTION public.start_export_task(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_export_task(text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_export_task(text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.finish_export_task(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_export_task(uuid, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_export_task(uuid, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_export_tasks(integer, integer, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_export_tasks(integer, integer, text, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_export_tasks(integer, integer, text, timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_events_page(timestamptz, timestamptz, timestamptz, uuid, integer) TO authenticated;

-- Four new functions. Without this they all answer PGRST202 from PostgREST's
-- in-memory schema cache until it happens to refresh, which reads as a broken
-- migration rather than a missing one-line NOTIFY.
-- test/migration-conventions.test.mjs guards this.
NOTIFY pgrst, 'reload schema';
