# Plan: time-limited proximity cards (expiring contractor/visitor badges)

**Status:** not started. This is a plan only — nothing in this document has
been implemented. Written 2026-10-01. Delete this file once the work lands
(update `README.md`'s roadmap bullet in the same commit), same as
`scan-logs-trim-plan.md` and `proximity-scanner-remarks-instructions.md`
were deleted after their work shipped — don't leave this sitting in the
repo root as dead weight.

**Read `Supabase/README.md`'s "Permission model" section, the `proximity_cards`
table row, and the two existing `pg_cron` jobs' change-log entries
(`archive_old_scan_events()` 2026-09-30, `trim_employee_scan_logs()`
2026-10-01) before touching anything.** This plan deliberately reuses both
jobs' conventions — naming, floor/default reasoning, the two-caller
permission split, verification style — rather than inventing new ones.
Consistency across the three scheduled jobs matters more than any one of
them being slightly more clever.

## Why this feature, and why now

Every proximity card today is permanent until an admin manually revokes it
(`revoke_proximity_card()` / the Proximity Cards page's Revoke button).
That's correct for employee badges, but this system's own stated purpose —
"permission-based access with multiple roles... hardware/kiosk scanner
integrations" — implies cases a permanent-until-revoked model doesn't cover
well:

- A contractor or vendor who needs building access for a fixed engagement
  (a week, a month) and should lose access automatically when it ends,
  not whenever someone remembers to revoke it.
- A visitor badge issued for a single day.
- Any temporary credential where "someone has to remember to revoke this"
  is itself the security gap.

Today, forgetting to revoke a temporary card is a silent, permanent hole —
exactly the kind of risk this project's own `README.md` already calls out
for unattended systems elsewhere (the offline-scanner staleness tradeoff,
the kiosk JWT expiry gap). This plan closes the equivalent gap for card
issuance.

## What this is NOT

This is explicitly **not** a role or access-scope change. An expiring card
behaves exactly like a permanent one in every way — RLS, scan matching,
analytics, exports — until it expires, at which point it behaves exactly
like a revoked one. No new permission tier, no new `employees.access_scope`
value. Keeping the blast radius this small is deliberate: the goal is one
well-isolated feature, not a re-architecture.

Also explicitly out of scope for this pass: notifying anyone by email/SMS
when a card is about to expire. The Alerts feature (`public.alerts`,
`raise_alert()`, the in-app Alerts page) already exists and is the natural
home for an expiry warning — wire into it (see Phase 2), but do not build
a new notification channel from scratch.

## Design

### Schema: one nullable column, no new table

```sql
alter table public.proximity_cards
  add column expires_at timestamptz;
```

Nullable, default `null` — a card with no `expires_at` is permanent, exactly
today's behavior for all 700+ existing cards with zero migration/backfill
needed. `expires_at` is a plain instant, not a duration — set once at issue
time (or edited later by an admin), not recomputed from "days remaining"
on every read. Storing a duration instead of an instant would just move the
same arithmetic bug class this project already paid down twice (`scan_logs`
parity, the archival window floors) into a new place for no benefit.

**Do not reuse `is_active`/`revoked_at` for this.** Those two columns are
the *current* state (manually revoked, yes/no) and already have clear,
narrow meaning throughout the codebase (`scan_proximity_code()`,
`get_scanner_offline_cache()`, the Proximity Cards page, RLS policies,
`ScannerStatsModel`). `expires_at` is a *schedule*, not a state — a card can
have a future `expires_at` and still be manually revoked early, or be
renewed (see "Renewing an expiring card" below) without ever having been
revoked. Collapsing the two into one concept is exactly the kind of "looks
like the same shape of problem" trap the `scan_logs` trim plan warned about
for `scan_events` vs. `scan_logs` — don't repeat it here with a different
pair of columns.

### What actually expires a card

A new daily `pg_cron` job, same pattern as the other two:

```sql
CREATE OR REPLACE FUNCTION public.expire_proximity_cards()
RETURNS TABLE(cards_expired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  -- Same two-caller permission split as archive_old_scan_events() /
  -- trim_employee_scan_logs(): pg_cron's scheduled call has no PostgREST
  -- request behind it (auth.uid() is null, proceed); an admin's on-demand
  -- run from Settings is a real request and must actually be an admin.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to expire proximity cards';
  end if;

  with expired as (
    update public.proximity_cards
    set is_active = false,
        revoked_at = now(),
        revoke_reason = 'Expired automatically (expires_at reached)'
    where is_active = true
      and expires_at is not null
      and expires_at <= now()
    returning id, proximity_code
  )
  select count(*) into v_count from expired;

  -- Reuse the alert the rest of this system already raises for anything
  -- scanner/security-relevant (see scan_proximity_code()'s raise_alert()
  -- calls for 'revoked_card_scan' etc.) rather than inventing a parallel
  -- notification path. One alert per run, not one per card, so a batch
  -- expiry doesn't flood the Alerts page the way scan_proximity_code()'s
  -- own 10-minute dedupe already prevents for scan-time alerts.
  if v_count > 0 then
    perform public.raise_alert('cards_auto_expired', 'info',
      v_count || ' proximity card' || (case when v_count = 1 then '' else 's' end) || ' expired automatically',
      jsonb_build_object('count', v_count), null, 0);
  end if;

  return query select v_count;
end;
$function$;

REVOKE ALL ON FUNCTION public.expire_proximity_cards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_proximity_cards() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_proximity_cards() TO authenticated;
```

This sets `is_active = false` and `revoked_at = now()` — **the exact same
two columns `revoke_proximity_card()` already sets** — so an expired card is
indistinguishable from a manually revoked one to every existing consumer:
`scan_proximity_code()` returns `inactive_card` for it with zero changes;
`get_scanner_offline_cache()`'s `card_active` field reflects it correctly
with zero changes; the Proximity Cards page's "revoked" badge and Renew
button work on it with zero changes; `ScannerStatsModel`'s "Inactive card"
stat and the Analytics drill-down count it correctly with zero changes.
This is the main payoff of the design: expiry is implemented entirely as
"a scheduled trigger for the revoke that already exists," not as a parallel
state machine every downstream reader has to learn about.

Set `revoke_reason` so an admin looking at a revoked card later (the
Proximity Cards page doesn't currently surface `revoke_reason` in the table
— check before assuming it does — but it's selectable, and is worth adding
to the row's title/tooltip in this same pass) can tell "this expired on
schedule" apart from "an admin revoked this for a reason."

Schedule, mirroring the other two jobs' convention exactly:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-proximity-cards') THEN
    PERFORM cron.unschedule('expire-proximity-cards');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-proximity-cards',
  '20 3 * * *', -- daily at 03:20 UTC — same off-peak window as the other two jobs, offset 10 minutes from each so none start in the same instant
  $$SELECT public.expire_proximity_cards()$$
);
```

**Why daily, not real-time:** a card that expires mid-afternoon stays valid
for scanning until the next 03:20 UTC run. If this feels too coarse once
it's live (e.g. a visitor badge issued for "today only" shouldn't still
scan at 11pm the same day), the fix is **not** a faster cron schedule —
it's checking `expires_at` directly inside `scan_proximity_code()` itself
(see "Phase 1b" below), which is cheap, exact, and doesn't depend on a
job having run recently. Build the cron job for cleanup/consistency and
the Alerts integration either way; don't skip Phase 1b assuming the cron
job alone is sufficient for a same-day expiry to actually deny access
promptly.

### Phase 1b: enforce at scan time too, not just via the cron sweep

`scan_proximity_code()` must treat an unexpired-on-the-row-but-past-due
card as already inactive, so there's no multi-hour window (worst case,
just under 24h with the schedule above) where an expired card still scans
as valid simply because the cron job hasn't run yet today.

In `scan_proximity_code()`, change:

```sql
elsif not v_card.is_active then
```

to:

```sql
elsif not v_card.is_active or (v_card.expires_at is not null and v_card.expires_at <= now()) then
```

Result stays `'inactive_card'` either way — a scanner (and the person
holding the card) should not be able to tell "revoked" and "expired" apart
from the scan result alone; that distinction belongs in `revoke_reason` for
an admin to review later, not in the live denial. **Do not add a new
`v_result` value like `'expired_card'`** — that would ripple into every
place that currently enumerates `scan_events.result` /
`get_scanner_scan_details()`'s closed filter list / `ScannerStatsModel`'s
stat cards / the Analytics drill-down, for a distinction nothing downstream
actually needs to act on differently.

Apply the identical `expires_at <= now()` check to `get_scanner_offline_cache()`'s
`card_active` field (currently just `pc.is_active`) and to
`test_scan_proximity_code()`'s parity-preview logic, for the same reason
`scan_proximity_code()` needs it: the offline scanner's whole reason to
exist is working from a cached snapshot without hitting the network per
scan, so if the cache itself doesn't bake in the expiry check, an offline
kiosk will keep accepting an expired card all day regardless of what the
cron job does server-side. This is the same "fail-open past the lookup
cache refresh window" tradeoff `Supabase/README.md`'s "Offline scanning"
section already documents and accepts for revoked cards generally — expiry
rides on that same accepted tradeoff, it doesn't need a new one.

### UI

**Issuing a card** (`JS/Components/ProximityCardModal.js`): add an explicit
choice, not an inferred one — a "Never expires" checkbox (checked by
default, so issuing a card with no further action keeps today's only
behavior unchanged) plus an `<input type="date">` for "Expires on" that is
disabled/hidden while the checkbox is checked and required once it's
unchecked. **Do not rely on "the date field is empty" as the signal for
permanent.** An empty date is ambiguous — did the admin mean "permanent" or
did they mean to set a date and not finish? — and that ambiguity is exactly
the kind of silent gap this whole feature exists to close for revocation;
it shouldn't be reintroduced one layer up, in how the card itself gets
issued. The checkbox is the explicit, unambiguous source of truth; the date
input only matters when the checkbox says it should.

This mirrors the schema directly: "Never expires" checked →
`expires_at = null`; unchecked → `expires_at` = the chosen date,
end-of-day. Store as an end-of-day timestamp in the card's own timezone
semantics — check how `get_attendance_report()`'s `p_tz` parameter handles
this project's day-boundary convention (`Supabase/README.md`) and reuse the
same reasoning rather than inventing a different one; don't let an
`expires_at` of "the date the admin picked" accidentally expire the card at
midnight UTC instead of end-of-day locally.

**Proximity Cards page** (`JS/Features/Proximity/ProximityPage.js`):
- Add an "Expires" column, populated from `expires_at` (formatted via the
  existing `fmtTime`/date-formatting helpers in `Utils/format.js` — check
  there before writing a new formatter). For a permanent card, show
  "Never" (a word, not a blank cell) — a blank cell reads as "unknown" or
  "data missing," which is a different thing entirely from "there is no
  expiry by design," and an admin scanning the column needs to tell those
  apart at a glance.
- A card expiring within 7 days gets a visually distinct treatment — reuse
  the existing `.badge warn` / `var(--warn)` convention already used for
  "Unassigned card" elsewhere rather than inventing a new color.
- **Renewing an expiring card:** `ProximityCardsModel.renew()` currently
  sets `is_active: true, revoked_at: null, issued_at: now()`. "Renew" must
  open the same explicit Never-expires-checkbox / Expires-on-date choice
  the issue modal uses — pre-filled from the card's current `expires_at`
  (checkbox checked if it's null) rather than defaulting to one or the
  other — so renewing an expiring card is a deliberate decision about its
  next expiry, never a silent side effect of clicking Renew. **Do not ship
  a version of Renew that clears `expires_at` to permanent without the
  admin explicitly choosing that** — that would quietly undo the entire
  point of this feature for any card that gets renewed instead of
  reissued.
- Filter dropdown: consider adding "Expiring soon" alongside the existing
  "Revoked only" filter (`ProximityPage.js`'s status filter options) —
  optional, not required for a correct first version.

**Settings page**: add a small "Expiring card sweep" status readout next
to "Scan data archival" and "Scan log trimming", same place and pattern —
how many cards are currently set to expire in the next 7 days, the
scheduled job's last run (`cron.job_run_details`, same best-effort
exception-wrapped read as `get_scan_archive_status()` /
`get_scan_logs_trim_status()`), and a "Run sweep now" button. New
`JS/Models/ScanCardExpiryModel.js` (or fold into
`JS/Models/ProximityCardsModel.js` if that reads more naturally once
written — use judgment, this plan doesn't mandate a new file, only that the
Settings panel exist). A new read-only RPC,
`get_card_expiry_status()`, mirroring the shape of
`get_scan_archive_status()` / `get_scan_logs_trim_status()`: counts due
soon, counts already expired-but-not-yet-swept (should normally be 0 given
Phase 1b, but worth surfacing if it's ever nonzero — would mean the cron
job is stuck), and the last run.

## Checklist for whoever implements this

- [ ] Migration: `proximity_cards.expires_at timestamptz` (nullable, no
      backfill needed), `expire_proximity_cards()`, grants, `pg_cron`
      schedule (`expire-proximity-cards`, `20 3 * * *` UTC).
- [ ] `scan_proximity_code()` updated to treat a past-due `expires_at` as
      inactive (Phase 1b) — **do not ship the cron job without this**, or
      an expired card stays scannable for up to ~24h.
- [ ] `get_scanner_offline_cache()` and `test_scan_proximity_code()` updated
      with the same `expires_at` check, for the offline-kiosk case.
- [ ] `get_card_expiry_status()` RPC, same pattern as the other two status
      RPCs.
- [ ] Verify against live data, in rolled-back transactions where
      destructive, before considering this done — mirror the verification
      depth of the `scan_logs` trim plan's own checklist:
  - A card with `expires_at` in the past and `is_active = true` scans as
    `inactive_card` *before* the cron job ever runs (proves Phase 1b, not
    just the cron sweep).
  - `expire_proximity_cards()` run manually actually flips `is_active`/
    `revoked_at`/`revoke_reason` on a synthetic past-due card and leaves an
    unexpired card (`expires_at` in the future, or null) untouched.
  - A permanent card (`expires_at is null`) is completely unaffected
    end-to-end — the existing 700+ cards must see zero behavior change.
  - `has_function_privilege()` confirms `anon`/`PUBLIC` blocked,
    `authenticated` allowed, same as the other two jobs.
  - An unprivileged caller is refused calling `expire_proximity_cards()`
    directly, same pattern as the other two jobs' refusal tests.
- [ ] `ProximityCardModal.js`: explicit "Never expires" checkbox (checked
      by default) plus an "Expires on" date, not an inferred blank-means-
      permanent field.
- [ ] `ProximityPage.js`: Expires column, near-expiry visual treatment,
      explicit (not accidental) decision about what Renew does to
      `expires_at`.
- [ ] Settings panel + status RPC + model wrapper, same place/pattern as
      the archival and trim panels.
- [ ] Tests: extend `test/access-control.test.mjs` and/or
      `test/offline-scanning.test.mjs` for any client-side logic that
      branches on `expires_at` (e.g. if `classifyCachedScan()` in
      `OfflineScanModel.js` grows an expiry check mirroring the RPC's —
      check whether that logic is better placed purely server-side in
      `get_scanner_offline_cache()`'s `card_active` field instead, which
      would mean the client needs no new branch at all, same as the
      `scan_logs` parity fix kept `offlineScanning.js` untouched by moving
      the fix to the field's *source* rather than the client's logic).
- [ ] `README.md` and `Supabase/README.md` change-log entries — match the
      detail level of the `scan_events` archival and `scan_logs` trim
      entries (both 2026-09-30/2026-10-01) as the bar.
- [ ] Update `README.md`'s roadmap — add a bullet for this if one doesn't
      already exist, mark it done the same way `scan_events` and
      `scan_logs` are marked done — and delete this file once that bullet
      is updated.

## Phase 2 (optional, separable, do after Phase 1/1b are live)

Wire an "expiring soon" warning into the existing Alerts feature
(`public.alerts`, `raise_alert()`) — e.g. a second scheduled check (or fold
into `expire_proximity_cards()` itself) that raises an `info`-severity
alert once per card when it enters a "expires within 3 days" window, deduped
per card the same way `scan_proximity_code()` dedupes its own alerts via
`p_dedupe_key`/`p_dedupe_minutes` so a long-running warning doesn't spam the
Alerts page daily. This is genuinely separable from Phase 1 — ship the
expiry mechanism and let it run for a while first; the warning is a
convenience on top, not a correctness requirement the way Phase 1b is.

## Explicitly out of scope

- Any new role, access-scope value, or RLS change — see "What this is NOT"
  above.
- Email/SMS notifications — Phase 2 uses the existing in-app Alerts
  feature only.
- A distinct `scan_events.result` value for "expired" vs. "revoked" — see
  the Phase 1b section for why this is deliberately collapsed into the
  existing `inactive_card` result.
- Recurring/renewable-on-a-schedule cards (e.g. "always expires every
  Friday") — this plan is for a fixed end date set once, not a recurrence
  rule. If that's ever wanted, it's a different, larger feature built on
  top of this one's `expires_at` column, not a reason to complicate this
  pass.
