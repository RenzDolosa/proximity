-- Retention must delete only what it can PROVE is old.
--
-- Asked to confirm that the two retention jobs can never touch data inside
-- the 180-day window. The answer for archive_old_scan_events() is yes,
-- unconditionally. For trim_employee_scan_logs() it was yes for every
-- well-formed entry and NO for two cases, both silent.
--
-- THE DEFECT. The keep-predicate was:
--
--     where (elem->>'scanned_at')::timestamptz >= v_cutoff
--
-- That is a whitelist of entries to KEEP, and `new_logs` is written back
-- over the employee's array. For a deletion job the distinction matters:
--
--   1. A MISSING scanned_at KEY DELETES THE ENTRY, AT ANY AGE. elem->>'…'
--      returns NULL, the cast returns NULL, and `NULL >= v_cutoff` is NULL,
--      which is not TRUE — so the row is excluded from new_logs and is gone.
--      An entry written a minute ago would be destroyed on the next run.
--
--   2. A MALFORMED scanned_at ABORTS THE WHOLE JOB. The cast raises
--      `invalid input syntax for type timestamp with time zone`, the
--      transaction rolls back, and nothing trims — which nobody would see,
--      because the status panel reads its last-run record from
--      cron.job_run_details and that table holds zero live rows.
--
-- Neither has fired yet: trg_append_scan_log() always writes scanned_at, and
-- the job has never deleted anything because the oldest data is ~7 weeks
-- old. That is exactly why this is worth fixing now — the first real run
-- processes 180 days of accumulated entries in one pass, unattended, and an
-- entry written by an older trigger or a backfill is the kind of thing that
-- only turns up then.
--
-- THE RULE, restated so it cannot drift: an entry is removed only when it
-- can be dated AND that date is before the cutoff. Anything undatable is
-- KEPT and counted, so it shows up as a data-quality problem rather than
-- disappearing as a retention outcome.
--
-- archive_old_scan_events() is deliberately NOT changed. scan_events.scanned_at
-- is `timestamptz NOT NULL DEFAULT now()`, a real column, and the predicate
-- is `WHERE scanned_at < v_cutoff` — neither failure above is reachable. The
-- new test pins that so it stays true.
--
-- COST: none. Same single pass over employees, inside the same cron job.

-- ---------------------------------------------------------------------------
-- 1. A cast that answers "I don't know" instead of raising
-- ---------------------------------------------------------------------------
--
-- STRICT so a NULL argument returns NULL without entering the body at all,
-- which is both faster and the same answer. The exception block costs a
-- subtransaction per call; at ~14,000 entries across 814 employees, once a
-- day, that is not worth optimising away.
CREATE OR REPLACE FUNCTION public.try_timestamptz(p_text text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO 'public'
AS $function$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end;
$function$;

COMMENT ON FUNCTION public.try_timestamptz(text) IS
  'Parses a timestamptz, returning NULL instead of raising on malformed input. Used by the retention jobs so one unparseable scan_logs entry cannot abort a run or be silently deleted.';

REVOKE ALL ON FUNCTION public.try_timestamptz(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_timestamptz(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.try_timestamptz(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The trim, with the rule inverted
-- ---------------------------------------------------------------------------
--
-- SIGNATURE AND RETURN TYPE UNCHANGED, so this is a CREATE OR REPLACE and
-- the pg_cron schedule and Models/ScanLogsTrimModel.js both keep working
-- untouched. The counts that answer "what would this remove" are added to
-- get_scan_logs_trim_status() below instead, where the return type is jsonb
-- and a new key is additive.
CREATE OR REPLACE FUNCTION public.trim_employee_scan_logs(p_older_than_days integer DEFAULT 180)
RETURNS TABLE(employees_trimmed integer, entries_removed integer, cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Floor of 90 retained. It is the hard guarantee that no configuration,
  -- from either caller, can bring the cutoff inside three months.
  v_days integer := greatest(90, coalesce(p_older_than_days, 180));
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_employees_trimmed integer;
  v_entries_removed integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan-log trimming';
  end if;

  with candidates as (
    select e.id,
           jsonb_array_length(e.scan_logs) as old_len,
           (select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
            from jsonb_array_elements(e.scan_logs) with ordinality as t(elem, ord)
            -- KEEP when the entry is newer than the cutoff, OR when it
            -- cannot be dated at all. coalesce(..., true) is the whole fix:
            -- an undatable entry yields NULL here, and NULL must mean "keep"
            -- rather than falling out of the aggregate.
            --
            -- ORDER BY inside the aggregate, not outside it. get_attendance_report()
            -- reads this array with ordinality and uses lead() over that order to
            -- derive direction, so a reshuffled array would mislabel IN/OUT until
            -- the next append re-sorted it.
            where coalesce(public.try_timestamptz(elem->>'scanned_at') >= v_cutoff, true)
           ) as new_logs
    from public.employees e
    where jsonb_array_length(e.scan_logs) > 0
  ),
  to_trim as (
    select id, new_logs, old_len, jsonb_array_length(new_logs) as new_len
    from candidates
    where jsonb_array_length(new_logs) < old_len
  ),
  updated as (
    update public.employees e
    set scan_logs = t.new_logs
    from to_trim t
    where e.id = t.id
    returning t.old_len - t.new_len as removed
  )
  select count(*)::int, coalesce(sum(removed), 0)::int
  into v_employees_trimmed, v_entries_removed
  from updated;

  return query select v_employees_trimmed, v_entries_removed, v_cutoff;
end;
$function$;

COMMENT ON FUNCTION public.trim_employee_scan_logs(integer) IS
  'Removes employees.scan_logs entries older than p_older_than_days (floored at 90). An entry is removed only when it can be dated AND that date precedes the cutoff; undatable entries are kept and reported by get_scan_logs_trim_status().undated_entries. Called daily by pg_cron, or on demand by an admin.';

REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.trim_employee_scan_logs(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Say what the next run would do, before it does it
-- ---------------------------------------------------------------------------
--
-- A SEPARATE FUNCTION, NOT A WIDER get_scan_logs_trim_status(). The first
-- draft of this migration added the counts to that function and a test
-- caught it: 20261107130000 deliberately rewrote it to read the
-- scan_logs_count counter column instead of jsonb_array_length(scan_logs),
-- because reading any part of a TOASTed jsonb fetches, decompresses and
-- parses the whole value — three such calls over 814 employees measured
-- 1852 ms. Folding a preview into it would have put that back and then some,
-- on a panel that paints on open.
--
-- So the split is the same one Settings → Employee photos already uses:
-- get_offline_thumb_stats() answers "is there anything here" in a few
-- hundred bytes, and the expensive pass only runs when somebody asks for it.
-- This is the expensive pass. It unnests every scan_logs array, which is the
-- only way to date the entries inside, and it runs on a button press.
--
-- Why it belongs in THIS migration rather than a later one: "retention only
-- removes data older than 180 days" is a claim, and would_remove_entries is
-- the evidence for it. Without a number the guarantee is only as good as a
-- reading of the SQL.
CREATE OR REPLACE FUNCTION public.preview_scan_logs_trim(p_older_than_days integer DEFAULT 180)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Same floor and the same arithmetic as the trim, so this cannot predict a
  -- cutoff the job would not use.
  v_days integer := greatest(90, coalesce(p_older_than_days, 180));
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_would_remove bigint;
  v_would_affect bigint;
  v_undated bigint;
  v_oldest timestamptz;
  v_newest_removed timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not permitted to preview scan-log trimming';
  end if;

  with entries as (
    select e.id,
           public.try_timestamptz(t.elem->>'scanned_at') as at_ts
      from public.employees e
      cross join lateral jsonb_array_elements(e.scan_logs) as t(elem)
     where e.scan_logs_count > 0
  )
  select count(*) filter (where at_ts is not null and at_ts < v_cutoff),
         count(distinct id) filter (where at_ts is not null and at_ts < v_cutoff),
         count(*) filter (where at_ts is null),
         min(at_ts),
         max(at_ts) filter (where at_ts is not null and at_ts < v_cutoff)
    into v_would_remove, v_would_affect, v_undated, v_oldest, v_newest_removed
    from entries;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'horizon_days', v_days,
    'oldest_entry_at', v_oldest,
    'would_remove_entries', v_would_remove,
    'would_affect_employees', v_would_affect,
    -- The guarantee as data rather than as a reading of the SQL: the newest
    -- entry that would go must be older than the cutoff. NULL when there is
    -- nothing to remove, which is the case today.
    'newest_removed_at', v_newest_removed,
    -- Kept by the trim, never deleted. A non-zero value is a data-quality
    -- finding, not a retention outcome.
    'undated_entries', v_undated
  );
end;
$function$;

COMMENT ON FUNCTION public.preview_scan_logs_trim(integer) IS
  'What the next trim_employee_scan_logs(p_older_than_days) run would remove, without removing it. Deliberately separate from get_scan_logs_trim_status(), which must stay off the TOASTed array — see 20261107130000. Expensive by nature; call it on an explicit press, never on a timer.';

REVOKE ALL ON FUNCTION public.preview_scan_logs_trim(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_scan_logs_trim(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_scan_logs_trim(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only; run through Supabase/local/Invoke-Sql.ps1)
--
-- 1. Nothing inside the window is at risk. Expect would_remove_entries = 0
--    today, because the oldest entry is ~7 weeks old and the cutoff is 180
--    days back. undated_entries should also be 0; if it is not, those are
--    entries the trim will now KEEP and somebody should look at them.
--    newest_removed_at must be null, or strictly before cutoff.
--
--      select jsonb_pretty(public.preview_scan_logs_trim(180));
--
-- 2. The guarantee, stated as data rather than as a reading of the SQL —
--    the newest entry that would be removed must be older than the cutoff:
--
--      with entries as (
--        select public.try_timestamptz(t.elem->>'scanned_at') as at_ts
--          from public.employees e
--          cross join lateral jsonb_array_elements(e.scan_logs) as t(elem)
--      )
--      select max(at_ts) as newest_removed,
--             now() - interval '180 days' as cutoff,
--             max(at_ts) < now() - interval '180 days' as safe
--        from entries
--       where at_ts is not null and at_ts < now() - interval '180 days';
--
--    `safe` must be true, or null when there is nothing to remove.
--
-- 3. The undatable cases are handled rather than fatal:
--
--      select public.try_timestamptz(null)        as should_be_null,
--             public.try_timestamptz('not a date') as should_also_be_null,
--             public.try_timestamptz('2026-01-02T03:04:05Z') as should_parse;
