# Supabase quota deadline — decision brief

**Trigger:** the Renz Dolosa organization went over its Free-plan egress quota
(7.779 GB against a 5 GB allowance) in the 11 Sep – 11 Oct 2026 cycle. Grace
period ends **03 Nov 2026**; after that the Fair Use Policy applies and
requests to projects return **HTTP 402**.

**Last updated:** 2026-10-05. Companion to `LOCAL_DATABASE_ARCHITECTURE.md`
(the target architecture) and `SUPABASE_EXIT_RUNBOOK.md` (the staged cutover
plan, if option C below is chosen). This document is the *whether and when*;
the runbook is the *how*.

---

## 1. Read the banner precisely before choosing a plan

The dashboard says projects will be restricted *"if your organization remains
over quota"*, and that restricted requests return 402.

Two things follow, and both change the plan:

- **This is a quota restriction, not a project deletion or a 90-day pause.**
  Those are different mechanisms with different recovery paths. Nothing here
  says data is deleted on 03 Nov. The risk being managed is *the app stops
  serving*, not *the data is gone*.
- **"Remains over quota" is a conditional.** Dropping back under 5 GB per
  cycle removes the trigger. That is a configuration-and-deploy problem, not a
  platform-migration problem.

An emergency migration off Supabase to solve a **$25/month bill** would be the
most expensive and highest-risk way to fix this. Price the cheap options first.

---

## 2. The finding that probably resolves this

**The egress fix is already written and is almost certainly not applied.**

`Supabase/migrations/20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql`
(merged 2026-10-05, commit `5a1d49e`) targets what the analysis identified as
the dominant egress source:

| Path | Before | After |
|---|---|---|
| Scanner lookup cache, per kiosk | whole roster (~430 KB) every 5 min ≈ **3.7 GB/cycle** | only employees changed since last sync |
| Dashboard, per open tab | 2 RPCs every 30 s, roster downloaded ~twice | 1 small RPC; roster only when it changed |

**Nothing in CI applies migrations.** `.github/workflows/deploy-supabase.yml`
triggers only on `Supabase/functions/**` and deploys only Edge Functions.
Verified 2026-10-05: no workflow runs `db push`, `migration up`, or
`apply_migration`.

Both clients were deliberately written to fall back to the old RPCs on
`PGRST202` when the new functions are absent — which is exactly the state the
project is in if the migration was never applied. **So the fix is deployed in
the browser and inert in the database, and egress is still running at the old
rate.**

### Do this first

1. Apply the migration to the live project (`supabase db push` is unsafe here —
   see §5 on history drift; apply the file directly via the SQL editor or MCP).
2. In **Usage**, switch the filter from *All projects* to **Proximity**. The
   7.779 GB figure is organization-wide and has never been attributed to a
   single project.
3. Watch uncached egress over the next 48 hours.

If that lands under 5 GB/cycle, the 03 Nov deadline stops applying and the
local-database work in `LOCAL_DATABASE_ARCHITECTURE.md` proceeds on its own
merits rather than under duress.

---

## 3. The three options, cheapest first

| | Option | Cost | Time | Risk | Removes deadline? |
|---|---|---|---|---|---|
| **A** | Apply the egress migration, get back under quota | 0 | hours | low | yes, if it works |
| **B** | Upgrade to Pro | ~$25/mo, 250 GB egress | minutes | none | yes, immediately |
| **C** | Migrate off Supabase before 03 Nov | engineering weeks | weeks | **high** | yes |

**Recommended: A, with B as the immediate safety net.**

B is worth buying on its own merits even if A succeeds. $25 converts a hard
deadline into no deadline, which buys the time to do C properly instead of in
four weeks. An access-control system is a bad thing to rush a platform
migration on — if the cutover goes wrong, nobody badges in.

Do **not** choose C because of this deadline. Choose C because sites must keep
operating while partitioned from the Internet, which is the real requirement
in `LOCAL_DATABASE_ARCHITECTURE.md` and is unrelated to billing.

---

## 4. P0 regardless of which option you pick

**Take a complete backup this week.** It is free, read-only, reversible, and
the only item on this page that is irreversible if skipped.

```bash
./Supabase/local/export-project.sh "postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
```

Use the **direct** connection string (port 5432, not the 6543 pooler), and
PostgreSQL client tools **17 or newer** — an older `pg_dump` refuses to dump a
17 server, which is the most common failure here.

The script captures schema (three forms), data, `auth.users`, roles,
extensions, every function definition, RLS policies, triggers, live migration
history, pg_cron jobs, realtime publication membership, storage bucket config,
object listings, and row counts for restore verification. It writes a
`MANIFEST.md` recording what it did **not** capture.

### What the script cannot capture — do these by hand

- **Storage object bytes** (the `scan-sounds` files; the listing is captured,
  the bytes are not)
- **Edge Function source** — `supabase functions download <name>`; confirm it
  matches `Supabase/functions/` in the repo
- **Secrets**: Edge Function env vars, and the Google Drive credentials
  `upload-employee-photo` uses. Not in the database, not recoverable after
  project loss.
- **Auth provider config**, SMTP, redirect URLs, JWT secret, API keys
- Employee photos live in **Google Drive**, not Supabase Storage — unaffected
  by anything happening to this project, but inventory the folder

---

## 5. The backup is also the schema reconciliation

`inventory/public-functions.sql` from that export contains every live function
definition — including the nine RPCs and the `alerts` / `scanners` tables that
`test/schema-drift.test.mjs` currently allowlists as missing from
`Supabase/migrations/`.

So the P0 backup and Phase 0 of the architecture plan are the same piece of
work. Capture once, use for both:

1. Run the export.
2. Diff `schema/public-schema.sql` against `Supabase/migrations/`.
3. Commit the missing objects as migrations (`alerts`, `scanners`,
   `raise_alert`, the nine RPCs, and the current `scan_proximity_code` — the
   committed baseline is behind live).
4. Delete the matching entries from `KNOWN_MISSING_FUNCTIONS` /
   `KNOWN_MISSING_DEPENDENCIES` in `test/schema-drift.test.mjs`.
5. Verify with `./Supabase/local/apply-migrations.sh` against a
   `supabase start` stack.

**`supabase db push` is unsafe against this project until step 3 is done.**
`Supabase/README.md` records that the live history is missing entries for
migrations that are nonetheless applied, and that repo filenames use different
version numbers than live. A push would try to re-run migrations that already
took effect. Apply files directly, then `supabase migration repair` once the
history is reconciled.

---

## 6. If you do go to option C

Only after §4 is done and verified.

```
Supabase PostgreSQL
      │  pg_dump (export-project.sh)
      ▼
Local PostgreSQL 17        ← restore + verify row counts
      ▼
Local Proximity API        ← the hard part; see LOCAL_DATABASE_ARCHITECTURE.md
      ▼
Existing frontend
```

The restore itself is the easy half. The work is that the browser currently
depends on Supabase for seven things, and only one of them is "a database":

1. PostgREST over `supabase.from()`
2. RPC over `supabase.rpc()`
3. **RLS as the actual permission boundary**
4. Auth and session management
5. Realtime subscriptions
6. Storage (scan sounds)
7. Edge Functions (`upload-employee-photo`, `admin-users`)

A database-only replacement does not work. Items 3 and 4 are the expensive
ones: replacing RLS with an application-layer boundary is a genuine reduction
in defence-in-depth, and auth has to be rebuilt rather than ported. Budget for
those honestly rather than discovering them at cutover.

Order of operations, if forced:

1. Restore to local PostgreSQL 17, verify against `row-counts.txt`
2. Stand up the local API with the Scanner path only — it has the clearest
   contract and already has the offline queue behind it
3. Pilot one site in parallel with Supabase still live
4. Cut over per-site, keeping Supabase as a read-only fallback until confident
5. Keep the IndexedDB device queue throughout — it is the device-level
   resilience layer, not a database replacement

**Do not** attempt a big-bang cutover before 03 Nov. If the timeline gets
tight, take option B and move the date.

---

## 7. Identifying what is actually consuming egress

The usage page gives you a total. It never tells you *which endpoint* spent it,
and every estimate in this document is inference from reading the client, not
measurement. The logs are where it stops being inference.

> ### Two things that will waste your time first
>
> **1. This is not the SQL Editor.** The logs are not in your Postgres
> database. Running these there fails with
> `ERROR: 42P01: relation "logs" does not exist`, which is Postgres correctly
> reporting that no such table exists.
>
> | Page | Path | Queries |
> |---|---|---|
> | SQL Editor | `/project/<ref>/sql` | your Postgres database |
> | **Logs Explorer** | `/project/<ref>/logs/explorer` | log analytics |
>
> **2. The log engine changed to ClickHouse** (announced in-product as "Logs
> now run on a ClickHouse-backed engine"). Older material — including earlier
> revisions of this document — used the previous BigQuery/Logflare schema:
> a per-source `edge_logs` table queried with `cross join unnest(...)`. That
> no longer exists and now fails with `Table "edge_logs" does not exist`.
>
> The current shape is **one `logs` table**, filtered by a `source` column,
> with nested fields in a `log_attributes` map:
>
> | | Old (BigQuery) | Current (ClickHouse) |
> |---|---|---|
> | table | `edge_logs` | `logs` where `source = 'edge_logs'` |
> | nesting | `cross join unnest(metadata)` | `log_attributes['request.path']` |
> | casting | `cast(x as int64)` | `toInt64OrZero(x)` |
>
> The editor also offers **Rewrite with Assistant**, which converts a
> BigQuery-era query for you. That is a legitimate shortcut, not a cop-out.

### The quickest route of all

The left sidebar has prebuilt **Collections** — `API Gateway`, `Postgres`,
`PostgREST`, `Auth`, `Storage`, `Realtime`, `Edge Functions`, `Cron`. For "what
is being requested", open **API Gateway** and set the time range (it defaults
to *Last hour*; widen it). No SQL at all. Do this before writing queries.

### Step 1 — confirm the sources available

```sql
select source, count() as rows
from logs
group by source
order by rows desc
```

### Step 2 — discover the attribute keys

The exact key names inside `log_attributes` are the part most likely to differ,
so enumerate them rather than guessing:

```sql
select arrayJoin(mapKeys(log_attributes)) as attribute, count() as rows
from logs
where source = 'edge_logs'
group by attribute
order by rows desc
limit 100
```

Look for the path key and a response-size key. Substitute the real names into
the queries below if they differ from what is written here.

### Step 3 — which endpoints spend the bytes

```sql
select
  log_attributes['request.path'] as path,
  count() as requests,
  sum(toInt64OrZero(log_attributes['response.headers.content_length'])) as total_bytes
from logs
where source = 'edge_logs'
group by path
order by total_bytes desc
limit 20
```

Order by `total_bytes`, not `requests` — they rank differently, and that gap is
the whole finding. A handful of fat responses beats a flood of thin ones.

### Step 4 — the decisive one

Whether kiosks are still calling the pre-fix whole-roster endpoint:

```sql
select
  log_attributes['request.path'] as path,
  count() as calls,
  sum(toInt64OrZero(log_attributes['response.headers.content_length'])) as total_bytes
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '%get_scanner_offline_cache%'
group by path
order by total_bytes desc
```

- **`..._compact` still arriving** ⇒ at least one kiosk runs pre-fix
  JavaScript. A tab open since before the deploy keeps the old modules in
  memory; applying the migration changed nothing for it.
  **Hard-reload every kiosk (Ctrl+Shift+R).**
- **`..._delta` only** ⇒ that kiosk is fixed, and if egress has not fallen the
  analysis in §2 is wrong — which is worth knowing before spending more.
- **Both** ⇒ some reloaded, some did not.

### Step 5 — which client, and which hours

```sql
select
  log_attributes['request.headers.user_agent'] as user_agent,
  count() as requests,
  sum(toInt64OrZero(log_attributes['response.headers.content_length'])) as total_bytes
from logs
where source = 'edge_logs'
group by user_agent
order by total_bytes desc
limit 20
```

Steady traffic through the night is a machine on a timer — a kiosk, or a
Dashboard left open — not people. That distinction decides whether the fix is
"reload the tabs" or "change the code".

### Caveats

- **Free-plan retention is about one day.** Enough to establish a rate, not to
  explain a whole cycle. Run these during a working day, and widen the time
  selector from its *Last hour* default.
- These queries have **not been run against this project** — the session that
  wrote them had no access to it. Steps 1 and 2 exist precisely so you verify
  the schema rather than trusting the rest verbatim.
- `content_length` is absent on chunked or streamed responses, so sums are a
  lower bound.
- Realtime WebSocket traffic does not appear in `edge_logs` at all. Check
  **Realtime Messages** on the usage page separately — at ~18k messages it was
  never a credible contributor here.

## 8. Related

- `SUPABASE_EXIT_RUNBOOK.md` — staged cutover plan for option C
- `LOCAL_DATABASE_ARCHITECTURE.md` — the target architecture and phasing
- `Supabase/local/export-project.sh` — the §4 capture tool
- `Supabase/local/apply-migrations.sh` — Phase 0 verification
- `test/schema-drift.test.mjs` — enforces §5's reconciliation
- `Supabase/README.md` — schema, RPC contracts, drift history
