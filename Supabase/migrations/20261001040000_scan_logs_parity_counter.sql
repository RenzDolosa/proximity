-- Phase 0 of the employees.scan_logs trim plan (see
-- scan-logs-trim-plan.md at the repo root for the full plan; delete that
-- file once Phase 1 ships too).
--
-- scan_logs IN/OUT direction has always been derived from
-- jsonb_array_length(scan_logs) at insert time (trg_append_scan_log()) and
-- mirrored client-side from the same arithmetic for offline scanning
-- (JS/Core/offlineScanning.js, fed by get_scanner_offline_cache()'s
-- 'scan_count' field). That makes the array's length load-bearing: trimming
-- old entries out of it — the whole point of the Phase 1 job this is laying
-- groundwork for — would silently flip every future scan's direction for
-- every employee whose array just got shorter.
--
-- This migration decouples direction from array length with a durable
-- counter that only ever increments, so a future trim can shrink scan_logs
-- without touching parity at all. Deliberately shipped and observed on its
-- own, with zero behavior change, before Phase 1 (the actual trim job)
-- is written.

ALTER TABLE public.employees
  ADD COLUMN scan_parity_count integer NOT NULL DEFAULT 0;

-- One-time backfill: set every employee's counter to their CURRENT
-- scan_logs length, so the very next scan computes the same direction the
-- old jsonb_array_length(scan_logs) arithmetic would have produced. This is
-- what makes the migration a no-op in effect — continuity, not a reset.
UPDATE public.employees SET scan_parity_count = jsonb_array_length(scan_logs);

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
        -- Parity now comes from scan_parity_count, not
        -- jsonb_array_length(scan_logs) — the counter only ever increments
        -- (see the UPDATE below), so a future trim of scan_logs cannot
        -- shift it. Read-then-increment in the same UPDATE, same as the
        -- old code read-then-appended in one statement.
        'direction', case when scan_parity_count % 2 = 0 then 'in' else 'out' end,
        'offline', coalesce((new.raw_payload->>'captured_offline')::boolean, false)
      )
    ),
    scan_parity_count = scan_parity_count + 1
    where id = new.employee_id;
  end if;
  return new;
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
      -- Still called 'scan_count' on the wire on purpose: this is the field
      -- JS/Core/offlineScanning.js already consumes for its own parity
      -- arithmetic, and keeping the name means that client file needs zero
      -- changes — only the source column moved, from
      -- jsonb_array_length(e.scan_logs) to the new durable counter.
      'scan_count', e.scan_parity_count,
      'remarks_log', coalesce(e.remarks_log, '[]'::jsonb)
    )), '[]'::jsonb)
    from public.proximity_cards pc
    left join public.employees e on e.proximity_card_id = pc.id
  );
end;
$function$;

-- delete_employee_scan_log() is deliberately UNCHANGED by this migration.
-- It already only removes one scan_logs entry (an admin-triggered,
-- one-row event) and never touched array-length-derived parity for
-- anything else; leaving scan_parity_count alone here means a deleted
-- entry no longer shifts any future scan's direction at all, which is
-- strictly better than before, not worse — there is nothing to fix here.
