-- Production schema baseline captured from kjwttqmbcjvkivgmwuev on 2026-09-22.
-- This migration contains schema only—no production rows or secrets.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'viewer');

CREATE TABLE public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  actor_id uuid,
  actor_name text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb
);

CREATE TABLE public.employees (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_code text NOT NULL,
  full_name text NOT NULL,
  department text,
  "position" text,
  email text,
  phone text,
  photo_url text,
  status text DEFAULT 'active'::text NOT NULL,
  scan_logs jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  proximity_card_id uuid NOT NULL,
  remarks_log jsonb DEFAULT '[]'::jsonb NOT NULL,
  photo_file_id text,
  photo_thumb_b64 text
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  role public.app_role DEFAULT 'viewer'::public.app_role NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  access_scope text DEFAULT 'all'::text NOT NULL
);

CREATE TABLE public.proximity_cards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  proximity_code text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  issued_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  revoke_reason text
);

CREATE TABLE public.scan_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  proximity_code text NOT NULL,
  employee_id uuid,
  proximity_card_id uuid,
  scanner_id text DEFAULT 'default-scanner'::text NOT NULL,
  result text NOT NULL,
  scanned_at timestamp with time zone DEFAULT now() NOT NULL,
  raw_payload jsonb
);

ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_proximity_card_id_fkey FOREIGN KEY (proximity_card_id) REFERENCES proximity_cards(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_proximity_card_id_key UNIQUE (proximity_card_id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_access_scope_check CHECK ((access_scope = ANY (ARRAY['all'::text, 'employee_manager'::text, 'scanner'::text])));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.proximity_cards ADD CONSTRAINT proximity_cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE ONLY public.proximity_cards ADD CONSTRAINT proximity_cards_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.proximity_cards ADD CONSTRAINT proximity_cards_proximity_code_key UNIQUE (proximity_code);
ALTER TABLE ONLY public.scan_events ADD CONSTRAINT scan_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.scan_events ADD CONSTRAINT scan_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.scan_events ADD CONSTRAINT scan_events_proximity_card_id_fkey FOREIGN KEY (proximity_card_id) REFERENCES proximity_cards(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.scan_events ADD CONSTRAINT scan_events_result_check CHECK ((result = ANY (ARRAY['matched'::text, 'unmatched'::text, 'inactive_card'::text, 'inactive_employee'::text, 'unassigned_card'::text])));

CREATE INDEX idx_employees_code_trgm ON public.employees USING gin (employee_code gin_trgm_ops);
CREATE INDEX idx_employees_created_by ON public.employees USING btree (created_by);
CREATE INDEX idx_employees_department ON public.employees USING btree (department);
CREATE INDEX idx_employees_full_name_trgm ON public.employees USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_employees_status ON public.employees USING btree (status);
CREATE INDEX idx_employees_updated_by ON public.employees USING btree (updated_by);
CREATE UNIQUE INDEX idx_proximity_active_code ON public.proximity_cards USING btree (proximity_code) WHERE (is_active = true);
CREATE INDEX idx_proximity_code_trgm ON public.proximity_cards USING gin (proximity_code gin_trgm_ops);
CREATE INDEX idx_proximity_created_by ON public.proximity_cards USING btree (created_by);
CREATE INDEX idx_scan_events_card ON public.scan_events USING btree (proximity_card_id);
CREATE INDEX idx_scan_events_employee ON public.scan_events USING btree (employee_id);
CREATE INDEX idx_scan_events_scanned_at ON public.scan_events USING btree (scanned_at DESC);

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select role in ('admin','manager') from public.profiles where id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.current_role_name()
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_scan_sounds()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select role = 'admin' or (role = 'manager' and access_scope in ('all', 'scanner'))
    from public.profiles where id = auth.uid()
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.can_view_employee_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public.is_admin() or role = 'manager' or access_scope in ('all','employee_manager')
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
    (select public.is_admin() or access_scope in ('all','scanner')
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
  select coalesce((
    select role = 'admin' or access_scope in ('all', 'employee_manager', 'scanner')
    from public.profiles where id = auth.uid()
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_action text, p_entity_type text, p_entity_id text DEFAULT NULL::text, p_detail jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.audit_log (actor_id, actor_name, action, entity_type, entity_id, detail)
  values (
    auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    p_action,
    p_entity_type,
    p_entity_id,
    p_detail
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_employee_remark(p_employee_id uuid, p_remark text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry jsonb;
begin
  if not (public.is_admin_or_manager() and public.can_view_employee_manager()) then
    raise exception 'not permitted to add remarks';
  end if;

  if p_remark is null or btrim(p_remark) = '' then
    raise exception 'remark cannot be empty';
  end if;

  v_entry := jsonb_build_object(
    'id', gen_random_uuid(),
    'remark', btrim(p_remark),
    'created_by', (select full_name from public.profiles where id = auth.uid()),
    'created_by_id', auth.uid(),
    'created_at', now(),
    'resolved', false
  );

  update public.employees
  set remarks_log = coalesce(remarks_log, '[]'::jsonb) || jsonb_build_array(v_entry)
  where id = p_employee_id;

  return v_entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_employee_scan_log(p_employee_id uuid, p_scan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not permitted to delete scan log entries';
  end if;

  delete from public.scan_events where id = p_scan_id and employee_id = p_employee_id;

  update public.employees e
  set scan_logs = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements(e.scan_logs) as elem
    where elem->>'scan_id' is distinct from p_scan_id::text
  )
  where e.id = p_employee_id;

  perform public.log_audit_event('scan_log_entry_deleted', 'employee', p_employee_id::text, jsonb_build_object('scan_id', p_scan_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_unassigned_proximity_cards()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'not permitted to delete proximity cards';
  end if;

  delete from public.proximity_cards
  where id not in (
    select proximity_card_id from public.employees where proximity_card_id is not null
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_audit_log(p_limit integer DEFAULT 200)
 RETURNS SETOF audit_log
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select *
  from public.audit_log
  where public.is_admin()
  order by created_at desc
  limit greatest(1, least(p_limit, 1000));
$function$;

CREATE OR REPLACE FUNCTION public.get_scan_feed(p_limit integer DEFAULT 25, p_scanner_id text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, proximity_code text, scanner_id text, result text, scanned_at timestamp with time zone, employee_id uuid, employee_name text, department text, photo_url text, photo_thumb_b64 text, direction text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to view the scan feed';
  end if;

  return query
    select se.id, se.proximity_code, se.scanner_id, se.result, se.scanned_at,
           e.id, e.full_name, e.department, e.photo_url, e.photo_thumb_b64,
           (
             select elem->>'direction'
             from jsonb_array_elements(e.scan_logs) as elem
             where elem->>'scan_id' = se.id::text
             limit 1
           ) as direction
    from public.scan_events se
    left join public.employees e on e.id = se.employee_id
    where p_scanner_id is null or se.scanner_id = p_scanner_id
    order by se.scanned_at desc
    limit p_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_scanner_offline_cache()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to use the scanner';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'proximity_code', pc.proximity_code,
      'card_active', pc.is_active,
      'employee_id', e.id,
      'full_name', e.full_name,
      'employee_code', e.employee_code,
      'department', e.department,
      'position', e.position,
      'updated_at', e.updated_at,
      'employee_status', e.status,
      'scan_count', coalesce(jsonb_array_length(e.scan_logs), 0),
      'remarks_log', coalesce(e.remarks_log, '[]'::jsonb)
    )), '[]'::jsonb)
    from public.proximity_cards pc
    left join public.employees e on e.proximity_card_id = pc.id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_scanner_offline_photos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to use the scanner';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id,
      'photo_thumb_b64', e.photo_thumb_b64
    )), '[]'::jsonb)
    from public.employees e
    where e.photo_thumb_b64 is not null
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_slow_query_stats(p_threshold_ms numeric DEFAULT 200, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view query statistics';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select
      queryid::text as query_id, -- bigint can exceed JS's safe integer range — sent as text, not a number
      left(query, 500) as query,
      calls,
      round(total_exec_time::numeric, 1) as total_exec_time_ms,
      round(mean_exec_time::numeric, 1) as mean_exec_time_ms,
      round(min_exec_time::numeric, 1) as min_exec_time_ms,
      round(max_exec_time::numeric, 1) as max_exec_time_ms,
      rows,
      case when (shared_blks_hit + shared_blks_read) = 0 then null
        else round(100.0 * shared_blks_hit / (shared_blks_hit + shared_blks_read), 1) end as cache_hit_pct,
      stats_since
    from pg_stat_statements
    where mean_exec_time >= p_threshold_ms
      -- Scoped to the app's own traffic (anon/authenticated/service_role
      -- — the three impersonated roles above), not Supabase's internal
      -- housekeeping (Realtime, background workers, the SQL editor
      -- itself running as postgres) or this RPC's own query, which would
      -- otherwise drown out real signal — raw pg_stat_statements is
      -- noisy across an entire managed-Postgres instance.
      and userid::regrole::text = any (array['anon', 'authenticated', 'service_role'])
      and query not ilike '%pg_stat_statements%'
      and dbid = (select oid from pg_database where datname = current_database())
    order by total_exec_time desc
    limit p_limit
  ) t;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  first_user boolean;
begin
  select not exists(select 1 from public.profiles) into first_user;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    case when first_user then 'admin'::public.app_role else 'viewer'::public.app_role end
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_self_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new; -- already a fully-trusted context — no restriction needed
  end if;

  if new.role is distinct from old.role
     or new.access_scope is distinct from old.access_scope
     or new.is_active is distinct from old.is_active
  then
    raise exception 'Only an admin can change role, access_scope, or is_active.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_slow_query_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not permitted to reset query statistics';
  end if;
  perform pg_stat_statements_reset();
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_employee_remark(p_employee_id uuid, p_remark_id uuid, p_resolved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_resolver text;
begin
  if not (public.is_admin_or_manager() and public.can_view_employee_manager()) then
    raise exception 'not permitted to resolve remarks';
  end if;

  select full_name into v_resolver from public.profiles where id = auth.uid();

  update public.employees e
  set remarks_log = (
    select coalesce(jsonb_agg(
      case when elem->>'id' = p_remark_id::text
        then elem || jsonb_build_object(
          'resolved', p_resolved,
          'resolved_by', case when p_resolved then v_resolver else null end,
          'resolved_at', case when p_resolved then now() else null end
        )
        else elem
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(e.remarks_log) as elem
  )
  where e.id = p_employee_id;

  perform public.log_audit_event(case when p_resolved then 'remark_resolved' else 'remark_reopened' end, 'employee', p_employee_id::text, jsonb_build_object('remark_id', p_remark_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_proximity_card(p_card_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id uuid;
  v_code text;
  v_entry jsonb;
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to revoke proximity cards';
  end if;

  update public.proximity_cards
  set is_active = false, revoked_at = now(), revoke_reason = p_reason
  where id = p_card_id
  returning proximity_code into v_code;

  if v_code is null then
    raise exception 'Proximity card not found';
  end if;

  select id into v_employee_id from public.employees where proximity_card_id = p_card_id;

  if v_employee_id is not null then
    v_entry := jsonb_build_object(
      'id', gen_random_uuid(),
      'remark', 'Proximity card ' || v_code || ' revoked' ||
                (case when nullif(btrim(coalesce(p_reason, '')), '') is not null then ': ' || btrim(p_reason) else '' end),
      'created_by', (select full_name from public.profiles where id = auth.uid()),
      'created_by_id', auth.uid(),
      'created_at', now(),
      'resolved', false
    );
    update public.employees
    set remarks_log = coalesce(remarks_log, '[]'::jsonb) || jsonb_build_array(v_entry)
    where id = v_employee_id;
  end if;

  perform public.log_audit_event('card_revoked', 'proximity_card', v_card_id::text, jsonb_build_object('proximity_code', v_code, 'reason', p_reason, 'employee_id', v_employee_id));

  return jsonb_build_object('success', true, 'employee_id', v_employee_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.scan_proximity_code(p_proximity_code text, p_scanner_id text DEFAULT 'default-scanner'::text, p_scanned_at timestamp with time zone DEFAULT now(), p_offline boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_card public.proximity_cards;
  v_employee public.employees;
  v_result text;
  v_scan_id uuid;
  v_direction text;
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to use the scanner';
  end if;

  select * into v_card from public.proximity_cards where proximity_code = p_proximity_code limit 1;

  if v_card is null then
    v_result := 'unmatched';
  elsif not v_card.is_active then
    v_result := 'inactive_card';
  else
    select * into v_employee from public.employees where proximity_card_id = v_card.id;
    if v_employee is null then
      v_result := 'unassigned_card';
    elsif v_employee.status <> 'active' then
      v_result := 'inactive_employee';
    else
      v_result := 'matched';
    end if;
  end if;

  if v_result <> 'unmatched' then
    insert into public.scan_events (proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload)
    values (
      p_proximity_code,
      v_employee.id,
      v_card.id,
      p_scanner_id,
      v_result,
      coalesce(p_scanned_at, now()),
      case when p_offline then jsonb_build_object('captured_offline', true) else null end
    )
    returning id into v_scan_id;
  end if;

  if v_result = 'matched' then
    select scan_logs -> -1 ->> 'direction' into v_direction from public.employees where id = v_employee.id;
    select * into v_employee from public.employees where id = v_employee.id; -- refresh so to_jsonb() below reflects the new scan_logs entry too
    return jsonb_build_object('result', v_result, 'scan_id', v_scan_id, 'direction', v_direction, 'employee', to_jsonb(v_employee));
  else
    return jsonb_build_object('result', v_result, 'scan_id', v_scan_id, 'employee', null);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.test_scan_proximity_code(p_proximity_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_card public.proximity_cards;
  v_employee public.employees;
  v_result text;
  v_direction text;
  v_prior_count int;
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to use the scanner';
  end if;

  select * into v_card from public.proximity_cards where proximity_code = p_proximity_code limit 1;

  if v_card is null then
    v_result := 'unmatched';
  elsif not v_card.is_active then
    v_result := 'inactive_card';
  else
    select * into v_employee from public.employees where proximity_card_id = v_card.id;
    if v_employee is null then
      v_result := 'unassigned_card';
    elsif v_employee.status <> 'active' then
      v_result := 'inactive_employee';
    else
      v_result := 'matched';
    end if;
  end if;

  if v_result = 'matched' then
    v_prior_count := coalesce(jsonb_array_length(v_employee.scan_logs), 0);
    v_direction := case when v_prior_count % 2 = 0 then 'in' else 'out' end;
    return jsonb_build_object('result', v_result, 'direction', v_direction, 'employee', to_jsonb(v_employee), 'test', true);
  else
    return jsonb_build_object('result', v_result, 'employee', null, 'test', true);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_append_scan_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.employee_id is not null and new.result = 'matched' then
    update public.employees
    set scan_logs = scan_logs || jsonb_build_array(
      jsonb_build_object(
        'scan_id', new.id,
        'proximity_code', new.proximity_code,
        'scanner_id', new.scanner_id,
        'scanned_at', new.scanned_at,
        'result', new.result,
        'direction', case when coalesce(jsonb_array_length(scan_logs), 0) % 2 = 0 then 'in' else 'out' end,
        'offline', coalesce((new.raw_payload->>'captured_offline')::boolean, false)
      )
    )
    where id = new.employee_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_audit_employee_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null then
    perform public.log_audit_event('employee_deleted', 'employee', old.id::text, jsonb_build_object('full_name', old.full_name, 'employee_code', old.employee_code));
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_audit_profile_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.access_scope is distinct from old.access_scope or new.is_active is distinct from old.is_active) then
    perform public.log_audit_event(
      'account_changed',
      'profile',
      new.id::text,
      jsonb_build_object(
        'full_name', new.full_name,
        'role', jsonb_build_object('from', old.role, 'to', new.role),
        'access_scope', jsonb_build_object('from', old.access_scope, 'to', new.access_scope),
        'is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active)
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_audit_proximity_card_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null then
    perform public.log_audit_event('proximity_card_deleted', 'proximity_card', old.id::text, jsonb_build_object('proximity_code', old.proximity_code));
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_or_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_scan_sounds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_employee_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_scanner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event(text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_employee_remark(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_employee_scan_log(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_unassigned_proximity_cards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_audit_log(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_feed(integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_photos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_slow_query_stats(numeric,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_self_privilege_escalation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_slow_query_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_employee_remark(uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_proximity_card(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_proximity_code(text,text,timestamp with time zone,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_scan_proximity_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_append_scan_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_audit_employee_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_audit_profile_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_audit_proximity_card_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.add_employee_remark(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_employee_remark(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_scan_sounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_scan_sounds() TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_employee_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_employee_manager() TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_scanner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_scanner() TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.current_role_name() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role_name() TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee_scan_log(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_scan_log(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_unassigned_proximity_cards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unassigned_proximity_cards() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_audit_log(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_log(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scan_feed(integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_feed(integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_cache() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_photos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scanner_offline_photos() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_slow_query_stats(numeric,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_slow_query_stats(numeric,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_self_privilege_escalation() TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_slow_query_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_slow_query_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_employee_remark(uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_employee_remark(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_proximity_card(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_proximity_card(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code(text,text,timestamp with time zone,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_proximity_code(text,text,timestamp with time zone,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.test_scan_proximity_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_scan_proximity_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_append_scan_log() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_audit_employee_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_audit_profile_changes() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_audit_proximity_card_delete() TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proximity_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.audit_log, public.employees, public.profiles,
  public.proximity_cards, public.scan_events TO anon, authenticated, service_role;

CREATE POLICY audit_log_select_admin ON public.audit_log FOR SELECT TO PUBLIC USING (is_admin());
CREATE POLICY employees_delete_admin_only ON public.employees FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY employees_insert_admin_manager ON public.employees FOR INSERT TO authenticated WITH CHECK ((is_admin_or_manager() AND can_view_employee_manager()));
CREATE POLICY employees_select_scope ON public.employees FOR SELECT TO authenticated USING (can_view_employee_manager());
CREATE POLICY employees_update_admin_manager ON public.employees FOR UPDATE TO authenticated USING ((is_admin_or_manager() AND can_view_employee_manager()));
CREATE POLICY profiles_admin_delete ON public.profiles FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY profiles_admin_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY profiles_select_own_or_admin ON public.profiles FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR is_admin()));
CREATE POLICY profiles_update_own_or_admin ON public.profiles FOR UPDATE TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR is_admin()));
CREATE POLICY proximity_delete_admin_only ON public.proximity_cards FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY proximity_select_scope ON public.proximity_cards FOR SELECT TO authenticated USING (can_view_employee_manager());
CREATE POLICY proximity_update_admin_manager ON public.proximity_cards FOR UPDATE TO authenticated USING ((is_admin_or_manager() AND can_view_employee_manager()));
CREATE POLICY proximity_write_admin_manager ON public.proximity_cards FOR INSERT TO authenticated WITH CHECK ((is_admin_or_manager() AND can_view_employee_manager()));
CREATE POLICY scan_events_insert_admin_only ON public.scan_events FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY scan_events_select_scope ON public.scan_events FOR SELECT TO authenticated USING ((is_admin() OR can_view_scanner()));

CREATE VIEW public.employee_directory WITH (security_invoker = true) AS
SELECT e.id, e.employee_code, e.full_name, e.department, e."position", e.email, e.phone,
       e.photo_url, e.status, pc.proximity_code AS active_proximity_code,
       pc.is_active AS proximity_card_active, jsonb_array_length(e.scan_logs) AS total_scans,
       e.scan_logs -> (jsonb_array_length(e.scan_logs) - 1) AS last_scan,
       jsonb_array_length(e.remarks_log) AS total_remarks,
       (SELECT count(*) FROM jsonb_array_elements(e.remarks_log) elem(value)
        WHERE (elem.value ->> 'resolved')::boolean IS NOT TRUE) AS open_remarks,
       e.created_at, e.updated_at, e.photo_file_id, e.proximity_card_id
FROM public.employees e JOIN public.proximity_cards pc ON pc.id = e.proximity_card_id;

CREATE VIEW public.proximity_card_directory WITH (security_invoker = true) AS
SELECT c.id, c.proximity_code, c.is_active, c.issued_at, c.revoked_at,
       e.id AS employee_id, e.full_name AS employee_name, e.employee_code
FROM public.proximity_cards c LEFT JOIN public.employees e ON e.proximity_card_id = c.id;

CREATE VIEW public.unassigned_active_proximity_cards WITH (security_invoker = true) AS
SELECT id, proximity_code FROM public.proximity_cards c
WHERE is_active = true AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.proximity_card_id = c.id);

GRANT ALL ON TABLE public.employee_directory, public.proximity_card_directory,
  public.unassigned_active_proximity_cards TO anon, authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('scan-sounds', 'scan-sounds', true, 5242880, ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4','audio/aac'])
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, public=EXCLUDED.public, file_size_limit=EXCLUDED.file_size_limit, allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY scan_sounds_authenticated_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'scan-sounds'::text);
CREATE POLICY scan_sounds_manage_delete ON storage.objects FOR DELETE TO PUBLIC USING ((bucket_id = 'scan-sounds'::text) AND public.can_manage_scan_sounds());
CREATE POLICY scan_sounds_manage_insert ON storage.objects FOR INSERT TO PUBLIC WITH CHECK ((bucket_id = 'scan-sounds'::text) AND public.can_manage_scan_sounds());
CREATE POLICY scan_sounds_manage_update ON storage.objects FOR UPDATE TO PUBLIC USING ((bucket_id = 'scan-sounds'::text) AND public.can_manage_scan_sounds()) WITH CHECK ((bucket_id = 'scan-sounds'::text) AND public.can_manage_scan_sounds());

CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
CREATE TRIGGER trg_employees_audit_delete BEFORE DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION trg_audit_employee_delete();
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_audit_changes AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION trg_audit_profile_changes();
CREATE TRIGGER trg_profiles_prevent_self_escalation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_self_privilege_escalation();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proximity_cards_audit_delete BEFORE DELETE ON public.proximity_cards FOR EACH ROW EXECUTE FUNCTION trg_audit_proximity_card_delete();
CREATE TRIGGER trg_scan_events_append_log AFTER INSERT ON public.scan_events FOR EACH ROW EXECUTE FUNCTION trg_append_scan_log();

ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_events;

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION public.rls_auto_enable();
