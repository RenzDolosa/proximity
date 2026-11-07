-- Two RLS findings from the 2026-11-06 audit, fixed together because they are
-- the same mistake at two layers: a privilege that is wide by default and
-- narrowed only by something further in.
--
-- =====================================================================
-- FINDING 1 -- anon holds every privilege on the tables holding the PII
-- =====================================================================
--
-- Measured on production:
--
--   grantee | table_name         | privs
--   --------+--------------------+--------------------------------------------
--   anon    | employees          | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   anon    | profiles           | (same)
--   anon    | proximity_cards    | (same)
--   anon    | export_tasks       | (same)
--   anon    | employee_directory | (same)
--   ...25 rows
--
-- NOT CURRENTLY REACHABLE, and this file is not a panic. RLS is enabled on
-- all 11 tables and every policy resolves false when auth.uid() is null;
-- PostgREST exposes no TRUNCATE; and anon is NOLOGIN so there is no direct
-- connection. Three things have to hold at once, and they do.
--
-- IT IS STILL WRONG, for two reasons.
--
-- First, TRUNCATE is in that list and RLS DOES NOT APPLY TO TRUNCATE. The
-- only thing standing between anon and an emptied employees table is that no
-- route currently reaches the verb. That is a routing accident, not a
-- permission.
--
-- Second, it makes RLS the single point of failure on the tables that matter,
-- and the anon key is PUBLISHED -- it ships in the client bundle by design.
-- One policy mistake, one DISABLE ROW LEVEL SECURITY, one table that slips
-- past rls_auto_enable, and that key reads production.
--
-- AND IT IS GROWING. export_tasks is in that list and 20261106150000 grants
-- nothing: Supabase's default privileges on schema public hand ALL to anon
-- for every new table. So this is not a legacy artifact to clean up once; it
-- is a default that re-applies to every migration anyone writes. The default
-- itself is changed below, or this file would need re-running forever.
--
-- The project already learned this for FUNCTIONS -- 61 explicit
-- `REVOKE ... FROM anon` statements, and Supabase/README.md records that
-- "REVOKE ... FROM PUBLIC doesn't cover anon on this project". Tables never
-- got the same treatment.
--
-- =====================================================================
-- FINDING 2 -- 'all' is the default access_scope, and it outranks the role
-- =====================================================================
--
--   can_view_employee_manager() = is_admin() OR role='manager'
--                                 OR access_scope IN ('all','employee_manager')
--   can_view_scanner()          = is_admin() OR access_scope IN ('all','scanner')
--   can_view_settings()         = role='admin'
--                                 OR access_scope IN ('all','employee_manager','scanner')
--
-- Each keys on SCOPE, and scope alone is enough. profiles.access_scope
-- DEFAULTs to 'all' and handle_new_auth_user() sets role='viewer' without
-- touching scope, so the next account created is a viewer that satisfies all
-- three -- able to read employees (email, phone, scan_logs), proximity_cards
-- and every scan_event, directly through PostgREST. The UI hides all of it;
-- the UI is not the boundary.
--
-- NOBODY IS EXPOSED TODAY, which is why this is prevention rather than
-- cleanup. Measured:
--
--   role    | access_scope | count
--   --------+--------------+-------
--   admin   | all          |     1
--   manager | all          |     5
--   viewer  | scanner      |     4
--
-- Not one viewer holds 'all'. The hole is unoccupied and opens on the next
-- signup.
--
-- THE FIX IS TO MAKE 'all' MEAN "everything your role allows", not
-- "everything". An explicit scope ('scanner', 'employee_manager') still
-- grants on its own, because that is how the four kiosk accounts are
-- provisioned and how a narrow grant is supposed to work. Only the catch-all
-- now needs a role behind it.
--
-- The column DEFAULT is deliberately left as 'all'. profiles_access_scope_check
-- permits only ('all','employee_manager','scanner'), so there is no narrower
-- legal value to default to -- and once 'all' is powerless without a role, the
-- default is harmless. Changing the constraint to add a 'none' would be a
-- bigger, more breakable change for the same result.
--
-- VERIFIED AGAINST ALL TEN LIVE ACCOUNTS: not one of them changes.
--
--   admin/all      -> is_admin() short-circuits all three            (no change)
--   manager/all    -> role='manager', or the new manager+all clause  (no change)
--   viewer/scanner -> 'scanner' is explicit, so scanner and settings
--                     still true; employee_manager was already false (no change)
--   viewer/all     -> now false everywhere                           (THE FIX)

-- ---------------------------------------------------------------------
-- 1. anon loses everything in schema public.
-- ---------------------------------------------------------------------
-- Blanket rather than a list of the 11 known tables: the point is that
-- nothing anon-reachable should exist here, including whatever a future
-- migration adds before anyone thinks about it.
--
-- Nothing in the app calls PostgREST before authenticating -- every .from()
-- and .rpc() in JS/ runs after a session exists, and sign-in itself talks to
-- GoTrue in the auth schema, which this does not touch.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Also closes the last anon function grant, set_updated_at(), which was a
-- trigger function anon could never usefully call -- Postgres refuses to
-- invoke trigger functions directly -- but which had no business being
-- granted.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Without this, the next CREATE TABLE re-grants ALL to anon and this file
-- becomes a chore instead of a fix. Scoped to the role that runs migrations;
-- Supabase's own defaults for other roles are left alone.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- ---------------------------------------------------------------------
-- 2. authenticated loses the three verbs RLS cannot govern.
-- ---------------------------------------------------------------------
-- TRUNCATE ignores RLS entirely. TRIGGER lets a grantee attach code to the
-- table. REFERENCES lets one point a foreign key at it. PostgREST issues none
-- of the three, and no function in this schema needs them, so removing them
-- costs nothing and removes the only privileges on these tables that policies
-- do not mediate.
--
-- SELECT/INSERT/UPDATE/DELETE are deliberately LEFT IN PLACE. Every one of
-- them is governed by a policy that this audit checked, and narrowing them
-- further needs something this repo cannot see -- see the note at the foot of
-- this file.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. 'all' now requires a role behind it.
-- ---------------------------------------------------------------------
-- Signatures, language, volatility and security context are all unchanged, so
-- these are true CREATE OR REPLACEs. Policies referencing them pick the new
-- bodies up with no further change.

CREATE OR REPLACE FUNCTION public.can_view_employee_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public.is_admin()
         or role = 'manager'
         -- 'employee_manager' stays sufficient on its own: it is the explicit,
         -- narrow grant. Only the catch-all 'all' was dropped from here, and
         -- it is already covered by the role = 'manager' test above for every
         -- account that legitimately holds it.
         or access_scope = 'employee_manager'
     from public.profiles where id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_scanner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public.is_admin()
         -- Explicit kiosk grant, any role. This is what the four live
         -- viewer/scanner accounts run on and it must keep working.
         or access_scope = 'scanner'
         -- The catch-all now needs a role behind it.
         or (role = 'manager' and access_scope = 'all')
     from public.profiles where id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_settings()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public.is_admin()
         or access_scope in ('employee_manager','scanner')
         or (role = 'manager' and access_scope = 'all')
     from public.profiles where id = auth.uid()),
    false
  );
$function$;

COMMENT ON FUNCTION public.can_view_scanner() IS
  'Scanner-surface read gate. An explicit access_scope of ''scanner'' grants on its own; the catch-all ''all'' requires role manager or admin. See 20261106190000 for why scope alone was not enough.';

-- Function bodies changed but no signature did, so PostgREST's cache is still
-- valid. Reloaded anyway, per the convention, and because the grant changes
-- above alter what it believes about every table.
-- test/migration-conventions.test.mjs guards this.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- VERIFY AFTER APPLYING
-- ---------------------------------------------------------------------
--   -- anon should return zero rows:
--   select table_name, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and grantee='anon';
--
--   -- authenticated should show no TRUNCATE/TRIGGER/REFERENCES:
--   select distinct privilege_type from information_schema.role_table_grants
--   where table_schema='public' and grantee='authenticated' order by 1;
--
-- ---------------------------------------------------------------------
-- DELIBERATELY NOT DONE HERE, and why
-- ---------------------------------------------------------------------
-- `authenticated` keeps SELECT on tables the client never reads directly --
-- scan_events, scan_events_archive, export_tasks, audit_log, alerts,
-- scanners, and the two unused directory views. Only four relations are
-- reached through PostgREST at all (employees, proximity_cards, profiles and
-- employee_directory), so those grants could be dropped, and dropping
-- scan_events in particular would stop any logged-in account pulling 150,504
-- rows of movement history in one request.
--
-- It is not done because several functions exist only in the live database --
-- get_alerts, get_scanners, get_onsite_roster, get_dashboard_stats,
-- get_scanner_performance_stats, update_scanner, raise_alert and others are
-- in test/schema-drift.test.mjs's KNOWN_MISSING allowlists. If any of them is
-- SECURITY INVOKER rather than DEFINER, it reads those tables with the
-- CALLER's privileges and revoking the grant breaks it. Guessing would trade
-- a theoretical exposure for a real outage.
--
-- One query decides it:
--
--   select p.proname, p.prosecdef as security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('get_alerts','get_scanners','get_onsite_roster',
--                       'get_dashboard_stats','get_unread_alert_count',
--                       'acknowledge_alert','acknowledge_all_alerts',
--                       'get_scanner_performance_stats','update_scanner',
--                       'raise_alert')
--   order by 1;
--
-- All true -> the remaining grants can go in a follow-up.
