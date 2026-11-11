-- Option A, part 2 of 3: where alerts get delivered.
--
-- Chunk names if applied through apply_migration rather than
-- Apply-Migration.ps1: alert_channels_schema, alert_channels_rls,
-- alert_channels_rpcs. They are one file here because Apply-Migration.ps1
-- runs a file at a time and a half-applied feature is worse than a big one.
--
-- A CHAT ID IS A CREDENTIAL. Anyone holding a Telegram chat id plus the bot
-- token can read or post to that chat, and an email address here is a
-- delivery target for anything the alert body contains — which includes
-- scanner names and timings. So this table is admin-only AND unreachable
-- directly: the client never touches it, only the three RPCs below, exactly
-- as 20261106190000 left the other ten RPC-only relations.
--
-- COST: one SELECT when an admin opens the Notifications panel, behind the
-- same 60s freshness window every other Settings group now uses. Call it six
-- requests a day against a ~6,700/day baseline.

-- ---------------------------------------------------------------------------
-- alert_channels_schema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which alert kind this delivers. NULL means every kind, which is the
  -- sane default for a three-scanner site — a per-kind row is for when
  -- somebody wants scanner_went_silent on a different chat from the rest.
  kind text,
  -- The transport. Telegram first; 'email' is accepted by the schema so the
  -- Edge Function can grow into it without a migration, and is rejected by
  -- notify-alert today rather than silently swallowed.
  channel text NOT NULL,
  -- Chat id, or address. Sensitive — see the note above.
  target text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT alert_channels_channel_check CHECK (channel IN ('telegram', 'email')),
  CONSTRAINT alert_channels_target_not_blank CHECK (btrim(target) <> '')
);

-- One row per destination per kind. Without this, pressing Save twice sends
-- every future alert to the same chat twice.
CREATE UNIQUE INDEX IF NOT EXISTS alert_channels_unique_target
  ON public.alert_channels (channel, target, coalesce(kind, ''));

-- The trigger below reads this on every alert INSERT, filtered to enabled
-- rows. Small table, but the index keeps it an index scan rather than a seq
-- scan on the one code path that must not get slower.
CREATE INDEX IF NOT EXISTS alert_channels_enabled_idx
  ON public.alert_channels (enabled) WHERE enabled;

-- Every new FK gets an index (project rule). created_by is nullable and only
-- read for display, but an unindexed FK still costs on auth.users deletes.
CREATE INDEX IF NOT EXISTS alert_channels_created_by_idx
  ON public.alert_channels (created_by);

-- ---------------------------------------------------------------------------
-- alert_channels_rls
-- ---------------------------------------------------------------------------

ALTER TABLE public.alert_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_channels_admin_all ON public.alert_channels;
-- (select auth.uid()) rather than a bare auth.uid() so the planner caches it
-- as an InitPlan instead of re-evaluating per row.
CREATE POLICY alert_channels_admin_all ON public.alert_channels
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- RLS is the second line, not the first. Supabase's default privileges grant
-- the client roles DML on every new table, so without these the policy above
-- would be the only thing standing between a logged-in viewer and this table.
REVOKE ALL ON TABLE public.alert_channels FROM anon;
REVOKE ALL ON TABLE public.alert_channels FROM authenticated;

-- ---------------------------------------------------------------------------
-- alert_channels_rpcs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_alert_channels()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not permitted to view alert channels';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at)
    from (
      select id, kind, channel, target, enabled, created_at
      from public.alert_channels
    ) t
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_alert_channel(
  p_channel text,
  p_target text,
  p_kind text DEFAULT NULL,
  p_enabled boolean DEFAULT true,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_target text := btrim(coalesce(p_target, ''));
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not permitted to change alert channels';
  end if;
  if v_target = '' then
    raise exception 'a delivery target is required';
  end if;
  if p_channel not in ('telegram', 'email') then
    raise exception 'unsupported channel: %', p_channel;
  end if;

  if p_id is not null then
    update public.alert_channels
       set channel = p_channel, target = v_target, kind = v_kind, enabled = coalesce(p_enabled, true)
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'alert channel not found';
    end if;
  else
    -- Upsert on the natural key, so saving the same chat twice edits the row
    -- rather than failing on the unique index with a constraint name.
    insert into public.alert_channels (channel, target, kind, enabled, created_by)
    values (p_channel, v_target, v_kind, coalesce(p_enabled, true), auth.uid())
    on conflict (channel, target, coalesce(kind, ''))
    do update set enabled = excluded.enabled
    returning id into v_id;
  end if;

  -- An admin action that changes where alerts are delivered. This is exactly
  -- what audit_log is for, and the target is NOT recorded — the audit log is
  -- readable by every admin and this is the one field worth not copying.
  perform public.log_audit_event(
    'alert_channel_set', 'alert_channels', v_id::text,
    jsonb_build_object('channel', p_channel, 'kind', v_kind, 'enabled', coalesce(p_enabled, true))
  );
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_alert_channel(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_channel text;
  v_kind text;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change alert channels';
  end if;

  delete from public.alert_channels
   where id = p_id
   returning channel, kind into v_channel, v_kind;
  if v_channel is null then
    raise exception 'alert channel not found';
  end if;

  perform public.log_audit_event(
    'alert_channel_deleted', 'alert_channels', p_id::text,
    jsonb_build_object('channel', v_channel, 'kind', v_kind)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_alert_channels() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_alert_channels() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_alert_channels() TO authenticated;

REVOKE ALL ON FUNCTION public.set_alert_channel(text, text, text, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_alert_channel(text, text, text, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_alert_channel(text, text, text, boolean, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_alert_channel(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_alert_channel(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_alert_channel(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
--   -- 1. the table is unreachable except through the RPCs
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='alert_channels';
--   -- expect zero rows for anon and authenticated
--
--   -- 2. RLS is on and the policy exists
--   select relrowsecurity from pg_class where oid = 'public.alert_channels'::regclass;
--   select polname from pg_policy where polrelid = 'public.alert_channels'::regclass;
--
--   -- 3. function grants
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
--   from pg_proc p
--   where p.proname in ('get_alert_channels','set_alert_channel','delete_alert_channel');
--   -- expect anon false, auth true, on all three
