-- Mirror auth.users.last_sign_in_at onto public.profiles, so Users & Roles can
-- show a per-account status dot.
--
-- WHY A MIRROR AND NOT A HEARTBEAT.
--
-- The request was a dot showing "who is currently online". This system has no
-- such signal for login accounts: public.profiles carries is_active (an admin
-- soft-disable) and nothing else, and nothing anywhere writes presence.
--
-- Real presence means a heartbeat: every signed-in tab writing on a timer, and
-- the page reading it back. That is a recurring request per signed-in user
-- forever -- precisely the cost this project has spent the last two weeks
-- removing (Log Ingestion bills one API-gateway event per request regardless of
-- payload size; see docs/EGRESS_BUDGET.md section 2f). It was ruled out for
-- that reason.
--
-- auth.users.last_sign_in_at is already maintained by GoTrue on every sign-in,
-- at no cost to us. Mirroring it with a trigger means:
--   * zero extra requests -- the column rides along on the SELECT * that
--     ProfilesModel.listUsers() already issues,
--   * zero client writes,
--   * zero polling.
--
-- What it honestly answers is "has this account been used recently", not "is
-- this person looking at the app right now". Components/StatusDot.js treats a
-- sign-in within 12 hours as active and puts the real elapsed time in each
-- dot's title, so nobody has to read precision into it that is not there.
--
-- A trigger on auth.users is established practice in this schema, not a new
-- liberty: trg_on_auth_user_created (baseline migration) already fires
-- AFTER INSERT on that table to create the profiles row this one updates.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;

-- Backfill, so the column is useful immediately rather than only for accounts
-- that happen to sign in after this migration.
UPDATE public.profiles p
   SET last_sign_in_at = u.last_sign_in_at
  FROM auth.users u
 WHERE u.id = p.id
   AND p.last_sign_in_at IS DISTINCT FROM u.last_sign_in_at;

CREATE OR REPLACE FUNCTION public.sync_profile_last_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update public.profiles
     set last_sign_in_at = new.last_sign_in_at
   where id = new.id;
  return new;
end;
$function$;

-- WHEN clause, not an unconditional AFTER UPDATE: GoTrue writes to auth.users
-- for token refreshes and other bookkeeping too, and this must not turn every
-- one of those into a profiles UPDATE. A profiles write bumps nothing else in
-- this schema, but it is still work nobody asked for, on a table read by every
-- page load.
DROP TRIGGER IF EXISTS trg_sync_profile_last_sign_in ON auth.users;
CREATE TRIGGER trg_sync_profile_last_sign_in
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW
WHEN (new.last_sign_in_at IS DISTINCT FROM old.last_sign_in_at)
EXECUTE FUNCTION public.sync_profile_last_sign_in();

REVOKE ALL ON FUNCTION public.sync_profile_last_sign_in() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_profile_last_sign_in() FROM anon;
REVOKE ALL ON FUNCTION public.sync_profile_last_sign_in() FROM authenticated;

-- No RLS change. profiles' existing read policy already governs who can see a
-- row at all, and this adds a column to rows the caller could already read.
-- Users & Roles is admin-only on both sides (isAdmin() in the page, the
-- policy in the database).

NOTIFY pgrst, 'reload schema';
