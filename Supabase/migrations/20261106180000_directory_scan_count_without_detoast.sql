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
-- scan_logs is a jsonb array that grows with every matched scan, so it is
-- TOASTed and compressed. Reading its LENGTH requires fetching every TOAST
-- chunk, decompressing, and parsing the whole value -- for every employee in
-- the result, on every visit, because EmployeesModel.listDirectory() refetches
-- the view in full and selects total_scans.
--
-- The arithmetic, from production on 2026-11-06: 150,504 scans spread over
-- 835 employees, ~59 compressed bytes per entry, so roughly 9 MB read and
-- ~28 MB of JSON parsed to produce 835 integers. Nothing else in that query
-- is expensive.
--
-- THE FIX IS A COLUMN THAT ALREADY EXISTS. 20261001040000 added
-- employees.scan_parity_count, a plain integer maintained by
-- trg_append_scan_log() on every matched scan. It holds the same number and
-- costs nothing to read -- a fixed-width column in the heap tuple, no TOAST
-- fetch, no decompression, no parse.
--
-- WHY THIS MATTERS BEYOND ONE SLOW PAGE. A 1.9-second query on a free-tier
-- instance occupies a connection that scans then queue behind. The kiosk
-- gives up on a scan after 4 seconds (ONLINE_SCAN_TIMEOUT_MS), falls back to
-- the offline path, queues the scan, and replays it later -- which is where
-- the duplicate-request 23505s in the log come from. Peak scan volume is only
-- 42/minute, far too low to saturate anything on its own, so contention from
-- queries like this one is the better explanation for scans crossing 4s.
--
-- A SEMANTIC NOTE, because the displayed number is a user-facing claim.
-- scan_parity_count only ever increments; it is not decremented by
-- delete_employee_scan_log() and is deliberately untouched by
-- trim_employee_scan_logs(). So it means "scans ever recorded", while
-- jsonb_array_length(scan_logs) means "scan entries still retained". They are
-- identical today -- nothing has been trimmed, because scan_events_archive is
-- empty and no data is yet 180 days old -- and they diverge only after a trim
-- or a manual log deletion.
--
-- That matters because DirectoryPage renders this number as the label on the
-- button that opens the scan log: "267 view". After a future trim the count
-- would exceed the list it opens. Flagged here rather than silently accepted;
-- if that becomes wrong, the fix is a separately maintained retained-count
-- column, not a return to de-TOASTing the array on every page load.
--
-- last_scan is left alone. It also reads the array, but the client does not
-- select it (see EmployeesModel.DIRECTORY_COLUMNS, which is explicit for
-- exactly this reason), so an unselected view column costs nothing. Removing
-- it would change the view's shape for any other consumer.
--
-- open_remarks and total_remarks read remarks_log the same way. Left alone
-- too: that array holds a few dozen entries org-wide, so it is nowhere near
-- the TOAST threshold and the cost is noise.

-- CREATE OR REPLACE VIEW, which requires the column list, order, names and
-- types to be unchanged. They are: scan_parity_count is integer, exactly what
-- jsonb_array_length() returned. Grants and the security_invoker setting
-- survive a replace, and security_invoker is restated rather than assumed --
-- losing it would silently turn this into a definer-rights view and hand
-- restricted roles rows their RLS forbids.
CREATE OR REPLACE VIEW public.employee_directory WITH (security_invoker = true) AS
SELECT e.id, e.employee_code, e.full_name, e.department, e."position", e.email, e.phone,
       e.photo_url, e.status, pc.proximity_code AS active_proximity_code,
       pc.is_active AS proximity_card_active,
       -- Was jsonb_array_length(e.scan_logs). See this file's header.
       e.scan_parity_count AS total_scans,
       e.scan_logs -> (jsonb_array_length(e.scan_logs) - 1) AS last_scan,
       jsonb_array_length(e.remarks_log) AS total_remarks,
       (SELECT count(*) FROM jsonb_array_elements(e.remarks_log) elem(value)
        WHERE (elem.value ->> 'resolved')::boolean IS NOT TRUE) AS open_remarks,
       e.created_at, e.updated_at, e.photo_file_id, e.proximity_card_id
FROM public.employees e JOIN public.proximity_cards pc ON pc.id = e.proximity_card_id;

COMMENT ON VIEW public.employee_directory IS
  'Employee Manager grid. total_scans reads employees.scan_parity_count, NOT jsonb_array_length(scan_logs); see 20261106180000 for the 1.9s query that change removes. last_scan still reads the array and is deliberately not selected by the client.';

-- No function changed, so PostgREST''s function cache is not stale. Its TABLE
-- and VIEW definitions are cached too, though, and total_scans changing from
-- an expression to a plain column alters what PostgREST believes about the
-- view. Cheap insurance against the grid returning stale shape information.
NOTIFY pgrst, 'reload schema';
