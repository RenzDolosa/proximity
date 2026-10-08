-- Stop alerting on reads that cannot be a card at all.
--
-- WHAT CHANGED SINCE 20261008000000. That migration split `unmatched` into
-- `truncated_card_read` (a suffix of a registered card) and `unknown_card_scan`
-- (everything else), and deliberately did NOT suppress anything — because the
-- suppression on the table at the time was a minimum-LENGTH rule, which would
-- have hidden exactly the failing employee scans that were the whole finding.
--
-- That reasoning still holds for short reads. It does not hold at the other end.
-- Measured 2026-10-08, after the truncation fix shipped, every surviving
-- `unknown_card_scan` was 40-71 characters of a single repeated digit against a
-- card set where all 727 active codes are exactly 10 digits. Those are a stuck
-- key on a reader, not a badge and not a truncation.
--
-- WHY THIS IS SAFE WHERE A LENGTH FLOOR WAS NOT. A truncated read is a SUFFIX
-- of a real card, and a suffix is never longer than the string it comes from.
-- So an over-length rule cannot hide a truncation, by construction. A length
-- FLOOR could, and that is the difference.
--
-- THE RULE. A code raises nothing when it is empty, longer than the longest
-- registered card, or contains a character no registered card uses. Both bounds
-- are read from proximity_cards rather than hardcoded, so issuing longer or
-- alphanumeric cards later relaxes this on its own with no code change.
--
-- A genuinely unknown card -- someone presenting an unregistered badge of a
-- plausible shape -- still raises `unknown_card_scan` at full weight. That is a
-- security event and is untouched.
--
-- COST. The branch already paid for one sequential scan of proximity_cards to
-- find a suffix match. This now gets the bounds and the suffix match from that
-- SAME single pass, so an unmatched scan does strictly less work than before,
-- not more. `right(...) = ...` replaces `like '%' || ...`, which also removes a
-- latent bug: a code containing % or _ was being treated as a LIKE wildcard.
--
-- Only the `unmatched` alerting branch changes. Every scan result the function
-- returns is untouched -- this cannot change whether a door opens, only what
-- lands in `alerts`.

CREATE OR REPLACE FUNCTION public.scan_proximity_code(
  p_proximity_code text,
  p_scanner_id text DEFAULT 'default-scanner'::text,
  p_scanned_at timestamp with time zone DEFAULT now(),
  p_offline boolean DEFAULT false
)
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
  v_enabled boolean;
  v_holder text;
  v_truncated_of text;
  v_truncated_holder text;
  v_max_len integer;
  v_all_numeric boolean;
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to use the scanner';
  end if;

  -- A disabled scanner is refused for LIVE scans only. Offline replays are
  -- always accepted: those swipes already physically happened, and refusing
  -- one would also stall the client's stop-on-first-failure sync queue.
  select is_enabled into v_enabled from public.scanners where scanner_id = p_scanner_id;
  if v_enabled is false and not p_offline then
    raise exception 'This scanner has been disabled by an administrator.';
  end if;
  insert into public.scanners (scanner_id) values (p_scanner_id)
  on conflict (scanner_id) do update set last_seen_at = now();

  select * into v_card from public.proximity_cards where proximity_code = p_proximity_code limit 1;

  if v_card is null then
    v_result := 'unmatched';
  elsif not v_card.is_active then
    v_result := 'inactive_card';
    select full_name into v_holder from public.employees where proximity_card_id = v_card.id;
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
    values (p_proximity_code, v_employee.id, v_card.id, p_scanner_id, v_result, coalesce(p_scanned_at, now()),
            case when p_offline then jsonb_build_object('captured_offline', true) else null end)
    returning id into v_scan_id;
  end if;

  -- Alerts (deduped per code for 10 min so a card held against the reader
  -- doesn't flood the list). Nothing here can raise, so it never rolls back the scan.
  if v_result = 'inactive_card' then
    perform public.raise_alert('revoked_card_scan', 'critical',
      'A revoked card was scanned' || coalesce(' (last assigned to ' || v_holder || ')', ''),
      jsonb_build_object('proximity_code', p_proximity_code, 'scanner_id', p_scanner_id, 'scanned_at', p_scanned_at, 'offline', p_offline),
      'revoked:' || p_proximity_code, 10);
  elsif v_result = 'unmatched' then
    -- One pass answers both questions: what shape a card can be, and whether
    -- this code is the tail of one.
    select max(length(c.proximity_code)),
           bool_and(c.proximity_code ~ '^[0-9]+$'),
           max(c.proximity_code) filter (
             where c.proximity_code <> p_proximity_code
               and coalesce(length(p_proximity_code), 0) > 0
               and right(c.proximity_code, length(p_proximity_code)) = p_proximity_code)
      into v_max_len, v_all_numeric, v_truncated_of
      from public.proximity_cards c;

    if coalesce(p_proximity_code, '') = ''
       or length(p_proximity_code) > coalesce(v_max_len, 0)
       or (coalesce(v_all_numeric, false) and p_proximity_code !~ '^[0-9]+$') then
      -- No possible match: not a card, and not a truncation of one. Raising
      -- nothing is the point of this migration.
      null;
    elsif v_truncated_of is not null then
      select e.full_name into v_truncated_holder
        from public.employees e
        join public.proximity_cards c on c.id = e.proximity_card_id
       where c.proximity_code = v_truncated_of;

      perform public.raise_alert('truncated_card_read', 'warning',
        'A card read was cut short — the scanner captured only part of '
          || coalesce(v_truncated_holder || '''s card', 'a registered card')
          || '. The badge did not register and had to be scanned again.',
        jsonb_build_object('proximity_code', p_proximity_code, 'matches_card', v_truncated_of,
                           'employee_name', v_truncated_holder,
                           'scanner_id', p_scanner_id, 'scanned_at', p_scanned_at, 'offline', p_offline),
        -- Deduped per SCANNER, not per code: every truncation is a different
        -- fragment, so a per-code key would mint a new row for each one. The
        -- actionable fact is "this kiosk is dropping digits", once per hour.
        'truncated:' || p_scanner_id, 60);
    else
      perform public.raise_alert('unknown_card_scan', 'warning', 'An unrecognized card was scanned',
        jsonb_build_object('proximity_code', p_proximity_code, 'scanner_id', p_scanner_id, 'scanned_at', p_scanned_at, 'offline', p_offline),
        'unknown:' || p_proximity_code, 10);
    end if;
  elsif v_result = 'inactive_employee' then
    perform public.raise_alert('inactive_employee_scan', 'warning',
      'A card belonging to an ' || v_employee.status || ' employee was scanned (' || v_employee.full_name || ')',
      jsonb_build_object('proximity_code', p_proximity_code, 'scanner_id', p_scanner_id, 'employee_id', v_employee.id, 'scanned_at', p_scanned_at, 'offline', p_offline),
      'inactive-emp:' || v_employee.id::text, 10);
  end if;

  if v_result = 'matched' then
    select scan_logs -> -1 ->> 'direction' into v_direction from public.employees where id = v_employee.id;
    select * into v_employee from public.employees where id = v_employee.id;
    return jsonb_build_object('result', v_result, 'scan_id', v_scan_id, 'direction', v_direction, 'employee', to_jsonb(v_employee));
  else
    return jsonb_build_object('result', v_result, 'scan_id', v_scan_id, 'employee', null);
  end if;
end;
$function$;

-- DESTRUCTIVE, and the reason this migration should be read before it is run.
-- Clears the alerts the rule above would never have raised. Measured 2026-10-08
-- this is 8 rows, all `unknown_card_scan`, all already acknowledged, each one
-- 40-71 characters of a repeated digit. Nothing that matches a card, nothing
-- that is a suffix of one, and nothing of a plausible shape is touched.
--
-- Check before running:
--   select count(*), max(length(detail->>'proximity_code')) from public.alerts
--    where kind = 'unknown_card_scan' and detail ? 'proximity_code'
--      and length(detail->>'proximity_code')
--          > (select max(length(proximity_code)) from public.proximity_cards);
delete from public.alerts a
where a.kind = 'unknown_card_scan'
  and a.detail ? 'proximity_code'
  and (
    length(a.detail->>'proximity_code')
      > (select max(length(c.proximity_code)) from public.proximity_cards c)
    or (
      (select bool_and(c.proximity_code ~ '^[0-9]+$') from public.proximity_cards c)
      and (a.detail->>'proximity_code') !~ '^[0-9]+$'
    )
  );
