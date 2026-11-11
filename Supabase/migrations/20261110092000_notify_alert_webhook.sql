-- Option A, part 3 of 3: get the alert out of the database.
--
-- pg_net rather than a dashboard Database Webhook. Both work; this one is in
-- the repo, reviewable in a diff, and recreated by replaying migrations onto
-- a fresh project. A webhook configured by hand in the dashboard is none of
-- those things, and this project has already been bitten once by a setting
-- that existed only in the dashboard ("Allow new users to sign up", on for
-- seven weeks with the code assuming otherwise).
--
-- NOTHING SECRET IS IN THIS FILE. The function URL and the shared secret are
-- read from Vault at call time. You create them once, yourself:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-alert', 'notify_alert_url');
--   select vault.create_secret('<a long random string>', 'notify_alert_secret');
--
-- Those two statements are NOT re-runnable: create_secret throws 23505 on a
-- name that already exists, and with both in one batch the first failing
-- aborts the second -- leaving the URL set and the secret missing, which
-- presents as the trigger silently doing nothing. The idempotent
-- create-or-update form is in functions/notify-alert/README.md.
--
-- The same random string goes into the function's own secrets as
-- NOTIFY_ALERT_SECRET (supabase secrets set), and notify-alert refuses any
-- request whose x-notify-secret header does not match it.
--
-- COST. Alerts run ~4/day once part 1 stops the overnight noise, so this is
-- roughly four outbound requests and four function_edge_logs lines per day
-- against a ~6,700/day baseline. The trigger is on alerts, NOT on the scan
-- path, and raise_alert's existing 180-minute dedupe means a scanner that
-- stays silent all day still only notifies a handful of times.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE EXCEPTION 'pg_net is not providing net.http_post; enable it before applying this migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- `net` is on the path because pg_net's functions live there; `vault` because
-- the secrets do. Both are schemas only a superuser-ish role can create in,
-- so widening the path here does not open a shadowing route.
SET search_path TO 'public', 'net', 'vault', 'extensions'
AS $function$
declare
  v_url text;
  v_secret text;
begin
  -- THE CHEAP CONDITION FIRST. If nobody has configured a destination there
  -- is nothing to do, and this must cost no more than an index probe on a
  -- table with single-digit rows. Everything below it — two Vault decrypts
  -- and an HTTP enqueue — only happens when a notification is really going
  -- somewhere.
  if not exists (
    select 1 from public.alert_channels
    where enabled
      and (kind is null or kind = new.kind)
  ) then
    return new;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'notify_alert_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'notify_alert_secret';

  if v_url is null or v_secret is null then
    -- Deliberately silent. A missing secret is a setup problem, not an
    -- alerting problem, and a RAISE here would write a log line on every
    -- alert forever — on a project whose log budget is the reason this
    -- feature was scoped the way it was.
    return new;
  end if;

  -- Fire and forget: net.http_post queues the request and returns an id
  -- immediately, so the INSERT that triggered this does not wait on Telegram
  -- and cannot fail because Telegram is down.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', v_secret
    ),
    body := jsonb_build_object(
      'id', new.id,
      'kind', new.kind,
      'severity', new.severity,
      'message', new.message,
      'created_at', new.created_at
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- AN ALERT MUST STILL BE RECORDED IF NOTIFYING FAILS. raise_alert() is
  -- called from check_scanner_silence() and from the scan path's own alert
  -- raisers; letting this trigger abort the INSERT would mean a broken
  -- Telegram config silently stops alerts being stored at all, which is a
  -- strictly worse failure than not being told about them.
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.trg_notify_alert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_notify_alert() FROM anon;
REVOKE ALL ON FUNCTION public.trg_notify_alert() FROM authenticated;

DROP TRIGGER IF EXISTS trg_alerts_notify ON public.alerts;
CREATE TRIGGER trg_alerts_notify
AFTER INSERT ON public.alerts
FOR EACH ROW
EXECUTE FUNCTION public.trg_notify_alert();

-- Not strictly needed: trg_notify_alert() is a trigger function, not an RPC,
-- so PostgREST never resolves it by name. Present because
-- migration-conventions.test.mjs requires it of every migration that writes a
-- function, and that rule is deliberately coarse so no author has to be right
-- about what PostgREST cached.
NOTIFY pgrst, 'reload schema';

COMMENT ON TRIGGER trg_alerts_notify ON public.alerts IS
  'Pushes new alerts to notify-alert via pg_net. No-ops when alert_channels has no enabled row for the kind, and never aborts the INSERT. Secrets live in Vault (notify_alert_url, notify_alert_secret); see 20261110092000.';

-- VERIFY -------------------------------------------------------------------
--
--   -- 1. the trigger exists and is on INSERT only
--   select tgname, tgtype from pg_trigger
--   where tgrelid = 'public.alerts'::regclass and not tgisinternal;
--
--   -- 2. secrets are present (names only — never select decrypted_secret here)
--   select name from vault.secrets where name in ('notify_alert_url','notify_alert_secret');
--   -- expect both
--
--   -- 3. end to end, after configuring a channel in Settings
--   select public.raise_alert('test_notification','info','Telegram wiring test',
--                             '{}'::jsonb, 'notify-test:' || gen_random_uuid()::text, 1);
--   -- expect a Telegram message within a few seconds
--
--   -- 4. what pg_net actually did with it
--   select id, status_code, error_msg, created
--   from net._http_response order by created desc limit 5;
--
-- ROLLBACK -----------------------------------------------------------------
--
--   drop trigger if exists trg_alerts_notify on public.alerts;
--   -- alerts keep being recorded; only the push stops.
