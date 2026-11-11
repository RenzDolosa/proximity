-- Option A, follow-up: ntfy as a free, no-account delivery channel.
--
-- WHY IT EARNS A PLACE NEXT TO VIBER. Viber needs a Public Account that
-- partners.viber.com may want to verify, a webhook registered before the bot
-- works at all, and a recipient who has subscribed. ntfy needs none of that:
-- publish to a topic over plain HTTP, and anyone subscribed to that topic
-- gets a push. There is no account, no token and no approval step, which
-- makes it the channel that can be working this afternoon.
--
-- THE TOPIC IS THE PASSWORD. On the public ntfy.sh instance there is no
-- other access control — anyone who knows or guesses the topic reads every
-- alert published to it, and this site's alerts carry scanner names and
-- timings. So Settings generates a 32-character random topic rather than
-- letting anyone name one "proximity-alerts", shows it masked afterwards,
-- and offers a copy button instead of printing it on a shared screen. That
-- is security by obscurity and it is labelled as such in the UI; self-hosting
-- ntfy is the real fix and needs no change here.
--
-- A FULL URL IS ACCEPTED AS WELL AS A BARE TOPIC, so moving to a self-hosted
-- server later is a Settings edit rather than a migration. notify-alert
-- splits the target into server and topic.
--
-- COST: identical to every other channel — one outbound request per alert,
-- ~4/day. Nothing is added to the scan path, the cron, or any poll.

ALTER TABLE public.alert_channels
  DROP CONSTRAINT IF EXISTS alert_channels_channel_check;
ALTER TABLE public.alert_channels
  ADD CONSTRAINT alert_channels_channel_check
  CHECK (channel IN ('ntfy', 'viber', 'telegram', 'email'));

-- VERIFY -------------------------------------------------------------------
--
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'alert_channels_channel_check';
--   -- expect: CHECK ((channel = ANY (ARRAY['ntfy','viber','telegram','email'])))
--
--   -- end to end, once a topic is saved in Settings
--   select public.raise_alert('test_notification','info','ntfy wiring test',
--                             '{}'::jsonb, 'notify-test:' || gen_random_uuid()::text, 1);
--   select id, status_code, error_msg, created
--   from net._http_response order by created desc limit 3;
--
-- ROLLBACK -----------------------------------------------------------------
--
--   -- Drop ntfy rows first or the tightened constraint will not validate.
--   delete from public.alert_channels where channel = 'ntfy';
--   alter table public.alert_channels drop constraint alert_channels_channel_check;
--   alter table public.alert_channels add constraint alert_channels_channel_check
--     check (channel in ('viber','telegram','email'));
