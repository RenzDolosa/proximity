-- Tell a truncated badge read apart from a genuinely unknown card.
--
-- WHAT THE DATA SAID. Measured against the live database on 2026-10-08:
--   * 761 of 762 proximity_codes are exactly 10 digits (the lone 3-character
--     outlier is "123", an inactive test card);
--   * 58 of 59 distinct `unknown_card_scan` codes were SUFFIXES of registered
--     cards — `037` of `0005204037`, `9295` of `0005669295`, `215056` of
--     `0005215056`.
--
-- So these were never unknown cards. They were real employees whose badge read
-- lost its leading digits, failed, and had to be scanned again. The reader is a
-- keyboard wedge; when the kiosk input is not focused as a read begins, the
-- first characters go nowhere and the ~200ms auto-submit fires on the remainder.
--
-- WHY NOT SUPPRESS. The obvious fix — drop the alert for implausible codes —
-- was tried and rejected. A minimum-length rule would have suppressed 1 of 59,
-- because that one 3-character test card drags the minimum to 3. Worse, the
-- alerts are evidence of employees' scans silently failing: hiding them would
-- have removed the only trace the problem leaves, since `unmatched` scans are
-- never written to scan_events.
--
-- WHAT THIS DOES. Keeps alerting, but says which problem it is. A code that is
-- a strict suffix of a registered card is raised as `truncated_card_read`,
-- naming the employee whose card it belongs to, so the alert reads as "a kiosk
-- is dropping digits" rather than "an intruder presented an unknown card". A
-- code matching nothing stays `unknown_card_scan`, which is a genuine security
-- event and must keep its current weight.
--
-- The primary fix is client-side: looksLikeCardCode() in
-- JS/Core/offlineScanning.js now rejects a short read before it is sent, so the
-- employee is told to scan again instead of their tap being lost. This is the
-- server-side half, for anything calling the RPC directly or a kiosk that has
-- not reloaded.
--
-- Only the `unmatched` branch changes. Every scan result the function returns is
-- untouched — this cannot change whether a door opens, only what lands in
-- `alerts`.
--
-- The suffix lookup is a sequential scan over proximity_cards, which cannot use
-- an index for `like '%...'`. It runs only on an unmatched scan, against 762
-- rows, and unmatched scans are rare once the client fix is live.

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
    -- Added 2026-10-08. Is this the tail of a real card rather than an unknown
    -- one? See this migration's header for the measurement behind it.
    select c.proximity_code into v_truncated_of
      from public.proximity_cards c
     where coalesce(p_proximity_code, '') <> ''
       and c.proximity_code <> p_proximity_code
       and c.proximity_code like '%' || p_proximity_code
     limit 1;

    if v_truncated_of is not null then
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
