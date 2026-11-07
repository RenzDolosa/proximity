-- Follow-up to 20261106190000, which left employee_directory wider than it
-- claimed. Verified after applying:
--
--   grantee       | table_name         | privs
--   --------------+--------------------+-----------------------------
--   authenticated | employee_directory | DELETE,INSERT,SELECT,UPDATE   <- expected SELECT
--   authenticated | employees          | DELETE,INSERT,SELECT,UPDATE
--   authenticated | profiles           | DELETE,INSERT,SELECT,UPDATE
--   authenticated | proximity_cards    | DELETE,INSERT,SELECT,UPDATE
--
-- THE MISTAKE: GRANT IS ADDITIVE. It does not describe an end state, it adds
-- to whatever is already there. 20261106190000 revoked ALL only from the ten
-- RPC-only relations; employee_directory was not among them, because it is
-- one of the four the client actually reaches. So it kept the baseline's
-- GRANT ALL, and the `GRANT SELECT ON public.employee_directory` at the foot
-- of that file re-stated one verb it already held and silently did nothing
-- about the other three.
--
-- The file's own comment said "the grid view is read-only", and the test
-- asserted the GRANT rather than the absence of the others, so both agreed
-- with each other and neither agreed with the database. Only reading the
-- post-apply grant table caught it.
--
-- NOT EXPLOITABLE, which is why this is a tidy-up and not an incident.
-- employee_directory joins employees to proximity_cards, and a view with more
-- than one relation in its FROM is not auto-updatable in PostgreSQL. There is
-- no INSTEAD OF trigger on it either. Any write attempt fails with "cannot
-- insert into view" before RLS or privileges are consulted at all.
--
-- It is still worth removing. A privilege that only fails because of a
-- property of the view is a privilege that becomes real the day someone adds
-- an INSTEAD OF trigger or simplifies the view to a single table -- and
-- whoever does that will not think to re-check a grant from two migrations
-- ago.

REVOKE INSERT, UPDATE, DELETE ON public.employee_directory FROM authenticated;

-- Restated so this file alone says what the end state is, rather than leaving
-- it to be inferred from the REVOKE above plus the previous migration. This
-- is the whole privilege the view should carry.
GRANT SELECT ON public.employee_directory TO authenticated;

-- The other two views are revoked entirely by 20261106190000 and the client
-- never reaches them, so they need nothing here.

COMMENT ON VIEW public.employee_directory IS
  'Employee Manager grid. total_scans reads employees.scan_logs_count, NOT jsonb_array_length(scan_logs); see 20261106180000 for the 1.9s query that change removes. last_scan still reads the array and is deliberately not selected by the client. SELECT-only for authenticated since 20261106200000.';

-- No function or signature changed, but the grant did, and PostgREST caches
-- what it believes each relation allows.
NOTIFY pgrst, 'reload schema';

-- VERIFY -- the same query as before. employee_directory should now read
-- SELECT alone, and the other three are unchanged:
--
--   select grantee, table_name,
--          string_agg(privilege_type, ',' order by privilege_type) as privs
--   from information_schema.role_table_grants
--   where table_schema='public' and grantee in ('anon','authenticated')
--   group by 1,2 order by 1,2;
