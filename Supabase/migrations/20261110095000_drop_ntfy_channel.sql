-- Reverts 20261110094000. ntfy is withdrawn for now; Telegram and Viber stay.
--
-- A FORWARD MIGRATION, NOT A DELETED FILE. 20261110094000 is already in the
-- applied ledger on the live project (inserted 2026-11-10 09:40 UTC), so
-- removing it from the repo would leave the migration history describing a
-- database that never existed, and a replay from scratch would diverge from
-- production. Undoing it forward keeps the repo an honest record of what the
-- database actually went through. Reinstating ntfy later is another forward
-- migration, and 20261110094000 is still there to copy from.
--
-- THE DELETE HAS TO COME FIRST. A tightened CHECK is validated against
-- existing rows, so a saved ntfy destination would make the ALTER fail with
-- a constraint violation rather than quietly dropping it. The delete is
-- scoped to channel = 'ntfy' and touches nothing else.

-- Returns the rows it removes, so an operator sees what was lost instead of
-- discovering later that a destination silently stopped receiving alerts.
-- Expected to be empty: the live panel had only a Telegram row.
WITH removed AS (
  DELETE FROM public.alert_channels
  WHERE channel = 'ntfy'
  RETURNING id, kind, enabled
)
SELECT count(*) AS ntfy_destinations_removed FROM removed;

ALTER TABLE public.alert_channels
  DROP CONSTRAINT IF EXISTS alert_channels_channel_check;
ALTER TABLE public.alert_channels
  ADD CONSTRAINT alert_channels_channel_check
  CHECK (channel IN ('viber', 'telegram', 'email'));

-- No NOTIFY pgrst: nothing PostgREST caches has changed. No function was
-- created or replaced, and a CHECK constraint is not part of the schema
-- cache. (migration-conventions.test.mjs only requires the reload from
-- migrations that write a function, and this one does not.)

-- VERIFY -------------------------------------------------------------------
--
--   -- 1. the constraint is back to two live channels plus the email stub
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'alert_channels_channel_check';
--   -- expect: CHECK ((channel = ANY (ARRAY['viber','telegram','email'])))
--
--   -- 2. nothing with an unsupported channel survived
--   select channel, count(*) from public.alert_channels group by channel;
--
--   -- 3. an ntfy row is now refused outright
--   -- insert into public.alert_channels (channel, target) values ('ntfy','x');
--   -- expect: new row violates check constraint
--
-- ROLLBACK -----------------------------------------------------------------
--
--   -- Re-apply 20261110094000, then restore the frontend and the sendNtfy
--   -- branch in notify-alert from the commit that introduced them.
--   alter table public.alert_channels drop constraint alert_channels_channel_check;
--   alter table public.alert_channels add constraint alert_channels_channel_check
--     check (channel in ('ntfy','viber','telegram','email'));
