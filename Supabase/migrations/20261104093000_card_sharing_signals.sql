-- One card, two sites, less time between them than the journey takes.
--
-- The fraud an attendance system is actually exposed to is a card being used
-- by someone other than its holder. Most of that is undetectable here -- a
-- colleague tapping your badge at your own site leaves evidence identical to
-- you tapping it yourself. But a card appearing at two SITES closer together
-- than a person could travel between them is not ambiguous: either the card
-- was handed over, or it was cloned. That is worth a critical alert.
--
-- COST: ZERO NEW REQUESTS, ZERO EGRESS. Detection runs in a trigger on
-- scan_events, inside the transaction a scan already performs. Hits land in
-- `alerts`, which the bell already polls via get_unread_alert_count().
-- Nothing new is fetched, nothing new is polled, and no row is written unless
-- a rule actually fires.
--
-- WHY A TRIGGER RATHER THAN A BRANCH INSIDE scan_proximity_code().
--
-- This started as an extra branch in that function's existing alert block,
-- which would have been the obvious place. It is the wrong place, for a
-- reason this repository already documents: Supabase/README.md's 2026-10-05
-- entry records that the committed scan_proximity_code() has been BEHIND the
-- live one before, and that nine client-called RPCs exist live with no
-- migration file at all -- the "backend shipped through the SQL Editor,
-- migration never written" pattern. A CREATE OR REPLACE here would be built
-- from the newest copy in this directory, and if anything was changed live
-- after 2026-10-08 this migration would silently revert it. That function
-- decides whether a door opens. It is not worth that risk for one feature.
--
-- A trigger is additive: nothing existing is replaced, so there is nothing to
-- revert. It also turns out to be the better design on its own merits -- it
-- covers every path that writes a scan, including the proximity-scan Edge
-- Function and offline replays, rather than only the one RPC.
--
-- The added work per matched scan is one scan of that employee's own
-- scan_logs array, which the trim job (20261001041500) caps -- 137 entries
-- for the busiest employee as measured there -- plus one primary-key lookup
-- on `scanners`.
--
-- WHAT THIS IS NOT. 20261008140000 is called "drop_impossible_card_alerts",
-- which sounds like this feature was already tried and removed. It was not.
-- That migration stopped alerting on impossible card READS -- 40-to-71
-- character strings of one repeated digit from a stuck reader key. Impossible
-- card TRAVEL has never been checked. Different failure, different rule.
--
-- A SECOND SIGNAL WAS CONSIDERED AND DROPPED. "Two arrivals with no departure
-- between them" was on the original sketch. It is already detected: that is
-- exactly `open_punch` in get_attendance_report(), and it occurred 382 times
-- in one week. Alerting on it would put 382 rows a week into a bell that
-- currently carries a handful, burying the signals that matter. Missing
-- tap-outs belong in a review queue, not the alert list.

-- Which physical place a scanner stands in. Nullable, and null is meaningful:
-- "not configured". Detection requires BOTH scanners involved to have a site,
-- so an unconfigured registry raises nothing rather than guessing. Three
-- readers at one site with no sites set is silent; the same three with sites
-- set is protected.
ALTER TABLE public.scanners ADD COLUMN site text;

-- How long it takes to get from one site to another, in minutes. A scan pair
-- faster than this is physically impossible for one person.
CREATE TABLE public.site_travel_rules (
  from_site text NOT NULL,
  to_site text NOT NULL,
  min_minutes integer NOT NULL CHECK (min_minutes > 0 AND min_minutes <= 1440),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  PRIMARY KEY (from_site, to_site)
);

-- ('*','*') is the fallback for any pair without its own row, so a three-site
-- operation needs exactly one number and never has to enumerate pairs. Adding
-- a specific pair later overrides the default with no migration.
--
-- RLS on, deliberately with no policies: every read and write goes through a
-- SECURITY DEFINER function below that checks its own permission, so there is
-- no reason for a client to hold a direct grant, and no policy to review when
-- the rules change.
ALTER TABLE public.site_travel_rules ENABLE ROW LEVEL SECURITY;

-- Travel time is treated as symmetric: a rule for A->B also governs B->A. For
-- road distance between fixed sites that is near enough, and it halves the
-- number of rows an admin has to maintain. If a one-way rule is ever needed,
-- the primary key already supports storing both directions separately -- only
-- this resolver would change.
CREATE FUNCTION public.site_travel_minutes(p_a text, p_b text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT r.min_minutes
    FROM public.site_travel_rules r
   WHERE (r.from_site = p_a AND r.to_site = p_b)
      OR (r.from_site = p_b AND r.to_site = p_a)
      OR (r.from_site = '*' AND r.to_site = '*')
   ORDER BY (r.from_site = '*')
   LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- The detection itself.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.trg_detect_card_sharing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_this_site text;
  v_prev_site text;
  v_prev_scanner text;
  v_prev_at timestamptz;
  v_gap_minutes numeric;
  v_need_minutes integer;
  v_name text;
begin
  if new.employee_id is null or new.result <> 'matched' then
    return new;
  end if;

  -- EVERYTHING BELOW IS INSIDE AN EXCEPTION GUARD, and that is the most
  -- important line in this file. scan_proximity_code()'s own alert block
  -- carries the comment "Nothing here can raise, so it never rolls back the
  -- scan". This trigger runs in the same transaction as the scan insert, so a
  -- fault in fraud DETECTION would refuse a badge at a door. A missed alert is
  -- an inconvenience; a turnstile that stops working because of a bug in an
  -- analytics rule is an outage. Detection fails silently, by design.
  begin
    select site into v_this_site from public.scanners where scanner_id = new.scanner_id;
    if v_this_site is null then
      return new;
    end if;

    -- THE PREDECESSOR IS FOUND BY TIME, NOT BY POSITION. scan_logs is not
    -- append-only any more: since 20261024090000 a backdated offline replay
    -- is spliced into the array by scanned_at, so `scan_logs -> -2` is "the
    -- second newest entry", which for a replay is not this scan's
    -- predecessor. Asking for the latest entry at or before this scan's own
    -- time, excluding this scan itself, is correct whether the new entry was
    -- appended or spliced.
    --
    -- This also does not care whether trg_scan_events_append_log has run yet:
    -- this scan is excluded either way, so both firing orders give the same
    -- answer.
    select l.elem ->> 'scanner_id', (l.elem ->> 'scanned_at')::timestamptz
      into v_prev_scanner, v_prev_at
      from public.employees e
      cross join lateral jsonb_array_elements(coalesce(e.scan_logs, '[]'::jsonb)) as l(elem)
     where e.id = new.employee_id
       and (l.elem ->> 'scan_id') is distinct from new.id::text
       and (l.elem ->> 'scanned_at')::timestamptz <= new.scanned_at
     order by (l.elem ->> 'scanned_at')::timestamptz desc
     limit 1;

    if v_prev_scanner is null or v_prev_scanner = new.scanner_id then
      return new;
    end if;

    select site into v_prev_site from public.scanners where scanner_id = v_prev_scanner;

    -- Both sites must be known. An unconfigured scanner produces no claim
    -- rather than a guess -- the alternative is every unset scanner being
    -- treated as a place of its own and alerting on normal movement.
    if v_prev_site is null or v_prev_site = v_this_site then
      return new;
    end if;

    v_gap_minutes := extract(epoch from (new.scanned_at - v_prev_at)) / 60.0;
    v_need_minutes := public.site_travel_minutes(v_prev_site, v_this_site);

    if v_need_minutes is null or v_gap_minutes >= v_need_minutes then
      return new;
    end if;

    select full_name into v_name from public.employees where id = new.employee_id;

    perform public.raise_alert('card_shared_between_sites', 'critical',
      coalesce(v_name, 'An employee') || '''s card was used at ' || v_prev_site
        || ' and ' || v_this_site || ' ' || round(v_gap_minutes)::text
        || ' minutes apart, which is less than the ' || v_need_minutes::text
        || ' minutes that journey takes.',
      jsonb_build_object(
        'employee_id', new.employee_id,
        'employee_name', v_name,
        'proximity_code', new.proximity_code,
        'from_site', v_prev_site,
        'to_site', v_this_site,
        'from_scanner_id', v_prev_scanner,
        'to_scanner_id', new.scanner_id,
        'previous_scanned_at', v_prev_at,
        'scanned_at', new.scanned_at,
        'gap_minutes', round(v_gap_minutes, 1),
        'required_minutes', v_need_minutes,
        'offline', coalesce((new.raw_payload ->> 'captured_offline')::boolean, false)),
      -- Deduped per employee per site PAIR, ordered so A->B and B->A share one
      -- key: someone moving back and forth past two readers is one situation
      -- to investigate, not a fresh alert each way.
      'card-shared:' || new.employee_id::text || ':'
        || least(v_prev_site, v_this_site) || '|' || greatest(v_prev_site, v_this_site),
      60);
  exception
    when others then
      -- Deliberately swallowed. See the comment above.
      null;
  end;

  return new;
end;
$function$;

-- Named so it sorts after trg_scan_events_append_log: Postgres fires
-- same-timing triggers in alphabetical order, and while this detection is
-- correct either way (see above), a deterministic order is one less thing to
-- reason about later.
CREATE TRIGGER trg_scan_events_detect_card_sharing
AFTER INSERT ON public.scan_events
FOR EACH ROW
EXECUTE FUNCTION public.trg_detect_card_sharing();

-- ---------------------------------------------------------------------------
-- Admin surface: the site on a scanner, and the travel rules.
-- ---------------------------------------------------------------------------

-- WHY THIS IS A NEW FUNCTION AND NOT A NEW ARGUMENT ON update_scanner().
--
-- update_scanner() and get_scanners() do not exist in any migration in this
-- repository -- they are live-only, created through the dashboard SQL Editor,
-- and are two of the nine RPCs pinned in test/schema-drift.test.mjs's
-- KNOWN_MISSING_FUNCTIONS. Adding p_site to update_scanner() would mean DROP
-- plus CREATE with a body reconstructed from Supabase/README.md's prose. That
-- body is the audit-logged admin write path for the registry, including the
-- is_enabled rule scan_proximity_code() enforces. Replacing working audited
-- code with a guess at working audited code is not a trade worth making for
-- one column.
--
-- So the site gets its own narrow function. The cost is one extra RPC on the
-- scanner registry page, which is admin-only and opened rarely. Paste the
-- current definitions of update_scanner() and get_scanners() and folding
-- `site` into both becomes a small follow-up that deletes this function, the
-- one below it, and the extra request.
CREATE FUNCTION public.set_scanner_site(p_scanner_id text, p_site text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_prev public.scanners;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change scanners';
  end if;

  select * into v_prev from public.scanners where scanner_id = p_scanner_id;
  if v_prev.scanner_id is null then
    raise exception 'unknown scanner';
  end if;

  -- Empty clears the site, which switches detection off for this scanner
  -- rather than leaving it half-configured.
  update public.scanners
     set site = nullif(btrim(coalesce(p_site, '')), '')
   where scanner_id = p_scanner_id;

  perform public.log_audit_event(
    'scanner_site_updated',
    'scanner',
    p_scanner_id,
    jsonb_build_object('site', nullif(btrim(coalesce(p_site, '')), ''),
                       'previous_site', v_prev.site)
  );
end;
$function$;

-- Just the registry's sites, because get_scanners() cannot be extended from
-- here for the reason above. Three rows of two short strings.
CREATE FUNCTION public.get_scanner_sites()
RETURNS TABLE(scanner_id text, site text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.can_view_scanner()) then
    raise exception 'not permitted to view scanners';
  end if;
  return query
  select s.scanner_id, s.site from public.scanners s order by s.scanner_id;
end;
$function$;

CREATE FUNCTION public.get_site_travel_rules()
RETURNS TABLE(from_site text, to_site text, min_minutes integer, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to view travel rules';
  end if;
  return query
  select r.from_site, r.to_site, r.min_minutes, r.updated_at
    from public.site_travel_rules r
   -- Default first, then pairs alphabetically: the fallback explains every row
   -- below it.
   order by (r.from_site <> '*'), r.from_site, r.to_site;
end;
$function$;

CREATE FUNCTION public.set_site_travel_rule(
  p_from_site text,
  p_to_site text,
  p_min_minutes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_from text;
  v_to text;
  v_prev public.site_travel_rules;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change travel rules';
  end if;
  if p_min_minutes is null or p_min_minutes <= 0 then
    raise exception 'travel time must be at least one minute';
  end if;

  v_from := coalesce(nullif(btrim(p_from_site), ''), '*');
  v_to := coalesce(nullif(btrim(p_to_site), ''), '*');

  -- A rule from a site to itself would make every second scan at one kiosk an
  -- impossible journey. The resolver only ever compares DIFFERENT sites, so
  -- such a row is unreachable -- rejecting it is clearer than storing
  -- something inert.
  if v_from = v_to and v_from <> '*' then
    raise exception 'a site cannot have a travel time to itself';
  end if;

  select * into v_prev from public.site_travel_rules
   where from_site = v_from and to_site = v_to;

  insert into public.site_travel_rules (from_site, to_site, min_minutes, updated_at, updated_by)
  values (v_from, v_to, least(p_min_minutes, 1440), now(), auth.uid())
  on conflict (from_site, to_site) do update
     set min_minutes = excluded.min_minutes,
         updated_at = now(),
         updated_by = excluded.updated_by;

  perform public.log_audit_event(
    'site_travel_rule_updated',
    'site_travel_rule',
    v_from || '|' || v_to,
    jsonb_build_object('from_site', v_from, 'to_site', v_to,
                       'min_minutes', least(p_min_minutes, 1440),
                       'previous_min_minutes', v_prev.min_minutes)
  );
end;
$function$;

CREATE FUNCTION public.delete_site_travel_rule(p_from_site text, p_to_site text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_from text;
  v_to text;
  v_prev public.site_travel_rules;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change travel rules';
  end if;
  v_from := coalesce(nullif(btrim(p_from_site), ''), '*');
  v_to := coalesce(nullif(btrim(p_to_site), ''), '*');

  select * into v_prev from public.site_travel_rules
   where from_site = v_from and to_site = v_to;
  if v_prev.from_site is null then
    return;
  end if;

  delete from public.site_travel_rules where from_site = v_from and to_site = v_to;

  perform public.log_audit_event(
    'site_travel_rule_deleted',
    'site_travel_rule',
    v_from || '|' || v_to,
    jsonb_build_object('from_site', v_from, 'to_site', v_to,
                       'previous_min_minutes', v_prev.min_minutes)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.site_travel_minutes(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.site_travel_minutes(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.site_travel_minutes(text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_detect_card_sharing() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_detect_card_sharing() FROM anon;
REVOKE ALL ON FUNCTION public.trg_detect_card_sharing() FROM authenticated;

REVOKE ALL ON FUNCTION public.set_scanner_site(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_scanner_site(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_scanner_site(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_scanner_sites() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_sites() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_sites() TO authenticated;

REVOKE ALL ON FUNCTION public.get_site_travel_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_site_travel_rules() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_site_travel_rules() TO authenticated;

REVOKE ALL ON FUNCTION public.set_site_travel_rule(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_site_travel_rule(text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_site_travel_rule(text, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_site_travel_rule(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_site_travel_rule(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_site_travel_rule(text, text) TO authenticated;
-- PostgREST answers an unknown function from its in-memory schema cache
-- without touching the database, so every RPC added above would return
-- PGRST202 until that cache happened to refresh. Convention here since
-- 20261015120000; 20261023070023 and 20261024090000 both missed it, which is
-- what test/migration-conventions.test.mjs now guards.
NOTIFY pgrst, 'reload schema';
