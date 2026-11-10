-- Option A, follow-up: Viber as the delivery channel.
--
-- WHY THIS NEEDS A TABLE AT ALL, when Telegram did not.
--
-- Telegram gives you a chat id from a single GET (`getUpdates`), so an admin
-- can read it off a curl command and paste it into Settings. Viber has no
-- polling equivalent: the ONLY way to learn a subscriber's id is to receive
-- a webhook callback when they subscribe to the Public Account. So the ids
-- have to be captured as they arrive and stored.
--
-- AND WE HAVE TO OWN THAT WEBHOOK. The tempting shortcut is to point Viber
-- at webhook.site once, read the id, and move on. That leaks: Viber also
-- posts `delivered` and `seen` callbacks for every message the bot sends, so
-- a third-party endpoint would receive a running feed of when this site's
-- alerts were delivered and read. The viber-webhook function exists to stop
-- that being the easy path.
--
-- TELEGRAM IS KEPT, not replaced. The channel column already abstracted the
-- transport and notify-alert already switched on it, so leaving Telegram in
-- costs nothing and keeps a working fallback for the hour when a Viber
-- Public Account is still being approved. Viber is what Settings offers
-- first and what the docs walk through.
--
-- COST: the webhook is inbound and event-driven. Subscribes happen a handful
-- of times ever. `delivered`/`seen` arrive ~2 per message per recipient and
-- are discarded at the top of the function without a database round trip or
-- a log line -- at ~4 alerts/day and two recipients that is ~16 invocations
-- a day against a ~6,700/day baseline.

-- ---------------------------------------------------------------------------
-- viber_channel_schema
-- ---------------------------------------------------------------------------

-- A CHECK constraint cannot be altered in place.
ALTER TABLE public.alert_channels
  DROP CONSTRAINT IF EXISTS alert_channels_channel_check;
ALTER TABLE public.alert_channels
  ADD CONSTRAINT alert_channels_channel_check
  CHECK (channel IN ('viber', 'telegram', 'email'));

-- Everyone who has subscribed to the Public Account, as reported by Viber.
--
-- NOT a list of employees. A Viber id is an opaque per-account string and
-- there is no join to the directory; `name` is whatever the person has set
-- as their Viber display name. Treated as a contact list, which is why it is
-- admin-only and revoked from the client roles like alert_channels.
CREATE TABLE IF NOT EXISTS public.viber_subscribers (
  viber_id text PRIMARY KEY,
  name text,
  -- Flipped by the `unsubscribed` event rather than deleting the row, so an
  -- admin can see that someone left instead of the destination quietly
  -- vanishing from the picker.
  subscribed boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS viber_subscribers_subscribed_idx
  ON public.viber_subscribers (subscribed) WHERE subscribed;

ALTER TABLE public.viber_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS viber_subscribers_admin_all ON public.viber_subscribers;
CREATE POLICY viber_subscribers_admin_all ON public.viber_subscribers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Same reasoning as alert_channels: Supabase's default privileges hand DML
-- on every new table to the client roles, so RLS would otherwise be the only
-- thing standing in front of a contact list.
REVOKE ALL ON TABLE public.viber_subscribers FROM anon;
REVOKE ALL ON TABLE public.viber_subscribers FROM authenticated;

-- ---------------------------------------------------------------------------
-- viber_channel_rpcs
-- ---------------------------------------------------------------------------

-- Backs the destination picker in Settings, so an admin chooses a name
-- instead of pasting an opaque id they have no way to verify.
CREATE OR REPLACE FUNCTION public.get_viber_subscribers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not permitted to view viber subscribers';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.name nulls last, t.viber_id)
    from (
      select viber_id, name, subscribed, last_seen_at
      from public.viber_subscribers
      where subscribed
    ) t
  ), '[]'::jsonb);
end;
$function$;

REVOKE ALL ON FUNCTION public.get_viber_subscribers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_viber_subscribers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_viber_subscribers() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
--   -- 1. the constraint now accepts viber and still rejects nonsense
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'alert_channels_channel_check';
--
--   -- 2. the contact list is unreachable except through the RPC
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'viber_subscribers';
--   -- expect zero rows
--
--   -- 3. after messaging the bot from Viber, the id should appear
--   select viber_id, name, subscribed, last_seen_at
--   from public.viber_subscribers order by last_seen_at desc;
--
-- ROLLBACK -----------------------------------------------------------------
--
--   -- Drop viber rows first or the tightened constraint will not validate.
--   delete from public.alert_channels where channel = 'viber';
--   alter table public.alert_channels drop constraint alert_channels_channel_check;
--   alter table public.alert_channels add constraint alert_channels_channel_check
--     check (channel in ('telegram','email'));
--   drop table if exists public.viber_subscribers;
--   drop function if exists public.get_viber_subscribers();
