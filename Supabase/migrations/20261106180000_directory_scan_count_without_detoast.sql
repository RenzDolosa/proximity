-- Opening Employee Manager de-TOASTed and JSON-parsed every employee's entire
-- scan_logs array, to produce one integer per row.
--
-- MEASURED, not inferred. The Postgres log for 2026-11-06 08:31 carries
-- `duration: 1859.992 ms` for a PostgREST query against employee_directory,
-- in the same minute as a burst of scan timeouts.
--
-- The view computed:
--
--   jsonb_array_length(e.scan_logs) AS total_scans
--
-- scan_logs grows with every matched scan, so it is TOASTed and compressed.
-- Reading its LENGTH means fetching every chunk, decompressing, and parsing
-- the whole value -- per employee, on every visit, because
-- EmployeesModel.listDirectory() refetches the view in full and selects
-- total_scans.
--
-- The arithmetic, from production on 2026-11-06: 150,504 scans over 814
-- employees at ~59 compressed bytes per entry, so roughly 9 MB read and
-- ~28 MB of JSON parsed to produce 814 integers. Nothing else in that query
-- is expensive.
--
-- WHY THIS MATTERS BEYOND ONE SLOW PAGE. A 1.9-second query on a free-tier
-- instance occupies a connection that scans then queue behind. The kiosk
-- gives up on a scan after 4 seconds (ONLINE_SCAN_TIMEOUT_MS), falls back to
-- the offline path, queues the scan, and replays it -- which is where the
-- duplicate-request 23505s handled by 20261106170000 come from. Peak scan
-- volume is only 42/minute, far too low to saturate anything on its own, so
-- contention from queries like this one is the better explanation for scans
-- crossing 4s.
--
-- WHY NOT scan_parity_count, which already exists. That was this migration's
-- first draft, and a measurement killed it: one employee of 814 already has
-- scan_parity_count <> jsonb_array_length(scan_logs). The counter only ever
-- INCREMENTS -- delete_employee_scan_log() does not decrement it and
-- trim_employee_scan_logs() deliberately leaves it alone, because it carries
-- IN/OUT parity and must not shift when the log is trimmed.
--
-- So it means "scans ever recorded" where the view needs "entries still in
-- the log". DirectoryPage renders this number as the label on the button that
-- OPENS that log ("267 view"), so the two must agree or the count lies about
-- the list behind it. They already disagree for one employee, and they will
-- disagree for EVERY employee once the data passes 180 days and
-- trim_employee_scan_logs() starts removing entries.
--
-- A SEPARATE, EXACTLY-MAINTAINED COUNT is therefore the answer. Three places
-- write scan_logs -- trg_append_scan_log(), delete_employee_scan_log() and
-- trim_employee_scan_logs() -- and all three do it with a plain
-- `update public.employees set scan_logs = ...`, so one BEFORE trigger on
-- that column catches every writer, including any future one nobody has
-- written yet. The count cannot drift, because nothing can change scan_logs
-- without passing through it.
--
-- last_scan is left alone. It reads the array too, but the client does not
-- select it (EmployeesModel.DIRECTORY_COLUMNS is explicit for exactly this
-- reason), and an unselected view column costs nothing. Removing it would
-- change the view's shape for any other consumer.
--
-- open_remarks and total_remarks read remarks_log the same way. Left alone
-- too: that array holds a few dozen entries org-wide, nowhere near the TOAST
-- threshold, so the cost is noise.

-- Nullable with no default, which in PG11+ is a catalogue change and not a
-- table rewrite. A STORED generated column would be more declarative but
-- requires ACCESS EXCLUSIVE and a full rewrite of a table whose TOAST holds
-- ~9 MB -- every scan would block for the duration.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS scan_logs_count integer;

COMMENT ON COLUMN public.employees.scan_logs_count IS
  'Number of entries in scan_logs, maintained by trg_sync_scan_logs_count(). Exists so employee_directory can report it without de-TOASTing the array on every page load; see 20261106180000. NOT the same as scan_parity_count, which only ever increments and carries IN/OUT parity.';

CREATE OR REPLACE FUNCTION public.trg_sync_scan_logs_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  -- new.scan_logs is already materialised by the statement that is writing
  -- it, so this reads no TOAST of its own. coalesce because the column is
  -- NOT NULL DEFAULT '[]' today, but a null would otherwise silently become a
  -- null count and render as 0.
  new.scan_logs_count := coalesce(jsonb_array_length(new.scan_logs), 0);
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.trg_sync_scan_logs_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_sync_scan_logs_count() FROM anon;
REVOKE ALL ON FUNCTION public.trg_sync_scan_logs_count() FROM authenticated;

-- UPDATE OF scan_logs, not a bare UPDATE: an employee's name or photo
-- changing must not re-read the array to recompute a number that cannot have
-- changed. BEFORE, so the value is written in the same tuple rather than
-- costing a second write.
DROP TRIGGER IF EXISTS trg_employees_sync_scan_logs_count ON public.employees;
CREATE TRIGGER trg_employees_sync_scan_logs_count
BEFORE INSERT OR UPDATE OF scan_logs ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_scan_logs_count();

-- Backfill. Deliberately AFTER the trigger exists, so a scan landing while
-- this runs is already correct rather than being fixed and then re-broken.
--
-- This is the one slow statement in the file: it reads every scan_logs array
-- once, the same ~9 MB the view was reading on every page load. It also takes
-- a row lock on each employee it touches, so a concurrent scan for that
-- employee waits. 814 rows, so seconds rather than minutes -- but run it
-- off-peak rather than at a shift change.
--
-- IS DISTINCT FROM makes a re-run after a partial apply touch only what is
-- still wrong.
UPDATE public.employees
SET scan_logs_count = coalesce(jsonb_array_length(scan_logs), 0)
WHERE scan_logs_count IS DISTINCT FROM coalesce(jsonb_array_length(scan_logs), 0);

-- Only now that every row has a value. NOT NULL means the view can never
-- report a null count that the UI would render as a confident 0.
ALTER TABLE public.employees ALTER COLUMN scan_logs_count SET DEFAULT 0;
ALTER TABLE public.employees ALTER COLUMN scan_logs_count SET NOT NULL;

-- CREATE OR REPLACE VIEW, which requires the column list, order, names and
-- types to be unchanged. They are: scan_logs_count is integer, exactly what
-- jsonb_array_length() returned, and it holds exactly the same value.
--
-- security_invoker is restated rather than assumed to survive the replace.
-- Losing it would silently turn this into a definer-rights view and hand
-- restricted roles rows their RLS forbids -- the trap the README records.
CREATE OR REPLACE VIEW public.employee_directory WITH (security_invoker = true) AS
SELECT e.id, e.employee_code, e.full_name, e.department, e."position", e.email, e.phone,
       e.photo_url, e.status, pc.proximity_code AS active_proximity_code,
       pc.is_active AS proximity_card_active,
       -- Was jsonb_array_length(e.scan_logs). Same number, no TOAST fetch.
       e.scan_logs_count AS total_scans,
       e.scan_logs -> (jsonb_array_length(e.scan_logs) - 1) AS last_scan,
       jsonb_array_length(e.remarks_log) AS total_remarks,
       (SELECT count(*) FROM jsonb_array_elements(e.remarks_log) elem(value)
        WHERE (elem.value ->> 'resolved')::boolean IS NOT TRUE) AS open_remarks,
       e.created_at, e.updated_at, e.photo_file_id, e.proximity_card_id
FROM public.employees e JOIN public.proximity_cards pc ON pc.id = e.proximity_card_id;

COMMENT ON VIEW public.employee_directory IS
  'Employee Manager grid. total_scans reads employees.scan_logs_count, NOT jsonb_array_length(scan_logs); see 20261106180000 for the 1.9s query that change removes. last_scan still reads the array and is deliberately not selected by the client.';

-- A new column and a new function, and the view's total_scans changes from an
-- expression to a plain column -- all of which PostgREST caches.
-- test/migration-conventions.test.mjs guards this.
NOTIFY pgrst, 'reload schema';

-- Verification, to run after applying. Both counts should be zero: no row
-- disagrees with its array, and no row is left null.
--
--   select count(*) filter (where scan_logs_count <> jsonb_array_length(scan_logs)) as wrong,
--          count(*) filter (where scan_logs_count is null) as missing
--   from public.employees;
