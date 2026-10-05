# `project-usage` Edge Function

> ## ⚠️ This function does not currently work, and may never
>
> **Verified against the live project on 2026-10-05.** There is no usage or
> billing endpoint in Supabase's Management API. Every candidate returned 404
> while the token itself was proven good by a 200 on the same run:
>
> ```
> /v1/projects/<ref>                        → 200   ← token valid, org resolved
> /v1/organizations/<org>/usage             → 404
> /v1/organizations/<org>/billing/usage     → 404
> /v1/organizations/<org>/daily-stats       → 404
> /v1/projects/<ref>/usage                  → 404
> /v1/projects/<ref>/billing/usage          → 404
> ```
>
> This matches the published OpenAPI spec (`https://api.supabase.com/api/v1-json`),
> which contains no path mentioning usage, billing, quota, analytics or logs.
> The dashboard's Usage page reads from something internal and unpublished.
>
> **The premise of this function was wrong.** It was written on the assumption
> that those four metrics were available from the Management API; they are not.
> Everything below describes what it *would* do if such an endpoint existed,
> and the probe is retained so that a future Supabase release is detected
> automatically rather than needing someone to remember to re-check.
>
> **Decide whether to keep it.** It currently costs a stored account
> credential (which expires and must be rotated), an Edge Function deploy
> dependency, and a secret — in exchange for nothing. Removing it leaves
> Settings → Usage showing Database size and the per-table breakdown from
> `get_database_usage()`, which needs none of that and works today. Read the
> four billing figures from the dashboard, and attribute egress with the Logs
> Explorer queries in `docs/SUPABASE_QUOTA_DECISION.md` §7.

Backs **Settings → Usage**. Intended to return this project's billing-cycle
usage for Egress, Cached Egress, Log Ingestion and Log Query.

## Why this is a function and not an RPC

Those four are **platform billing metrics**. They are not in the database and
no RPC can reach them — they exist only in Supabase's Management API at
`api.supabase.com`, which authenticates with a Personal Access Token.

That token is a **server-side credential regardless of how narrowly it is
scoped** — it authenticates to Supabase's control plane, not to this project's
data API. It cannot sit in client JavaScript behind an anon key. So the token
lives here as an Edge Function secret, the browser calls this function, and the
browser never sees the token and never talks to `api.supabase.com`.

**Scope it down when issuing it.** Supabase's token generator supports
project-scoped tokens with per-category permissions (the legacy
full-account token is a separate, explicitly-labelled option — do not use it
here). Issue this one as:

- **Scope:** Project → the organization → `proximity` only. Not Organization,
  which spans every project in the org.
- **Permissions:** read-only, and only the category covering project
  usage/diagnostics. This function issues a single `GET` and never writes, so
  no write permission is ever correct. Leave Database, Application services and
  Infrastructure and delivery at None — it touches none of them.

A token scoped that way, if leaked, exposes this project's usage figures and
nothing else. That is a meaningfully different risk from the account-wide
legacy token, and it is worth the extra minute at issue time.

The fifth figure on the panel, **Database size**, deliberately does *not* come
from here. `pg_database_size()` is readable from inside the database, so
`get_database_usage()` provides it at no token and no external call. That split
is also why the panel still shows something useful when this function is
unconfigured.

## Setup

**One secret**, not committed:

| Secret | Value |
|---|---|
| `MANAGEMENT_API_TOKEN` | Personal Access Token from [account/tokens](https://supabase.com/dashboard/account/tokens) |

```bash
supabase secrets set MANAGEMENT_API_TOKEN=sbp_xxx
```

**Not** `SUPABASE_MANAGEMENT_TOKEN`: Supabase reserves the `SUPABASE_` prefix
for the variables it injects itself and rejects user secrets that use it
("Name must not start with the SUPABASE_ prefix").

There is deliberately no project-ref secret. The ref is derived from the
platform-injected `SUPABASE_URL` (`https://<ref>.supabase.co`). That is one
less thing to set, and it cannot drift — a hand-typed ref that disagreed with
the project the function actually runs in would report **someone else's usage
with no visible error**. `MANAGEMENT_PROJECT_REF` overrides the derivation for
the cases where the URL is not the ref (self-hosted, or a branch database whose
usage should be attributed to the parent).

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform.

Until the token is set the function returns `503 { code: "not_configured" }`, and
the panel says so explicitly rather than showing a generic error — a one-time
setup task and an incident should not look alike.

**Supabase access tokens expire**, and the expiry is chosen at issue time. When
it lapses the panel starts reporting *"Supabase rejected the management
token"* — accurate, but easy to misread as a bug months after you set it up.
Note the expiry date somewhere you will see it, or pick a long one deliberately.
`Last used` on the [tokens page](https://supabase.com/dashboard/account/tokens)
is the quickest confirmation that the function has ever actually run.

Rotate the token on staff change, and never put it anywhere a browser can
reach. Mint it separately from the `SUPABASE_ACCESS_TOKEN` that
`.github/workflows/deploy-supabase.yml` uses for Edge Function deploys — that
one needs write access, this one does not, and separate tokens can be rotated
independently.

## Contract

`POST {}` → `200`

```jsonc
{
  "period_start": "2026-09-11T00:00:00Z",
  "period_end":   "2026-10-11T00:00:00Z",
  "metrics": [
    { "key": "egress", "label": "Egress", "value": 7978000000, "limit": 5000000000, "unit": "bytes" }
  ],
  "partial": false,
  "notes": [],
  "response_keys": ["egress", "..."]
}
```

Errors: `{ error, code? }`.

| Status | `code` | Meaning |
|---|---|---|
| 401 | — | no `Authorization` header |
| 403 | — | caller is not an admin |
| 503 | `not_configured` | secrets not set |
| 503 | `management_token_invalid` | token revoked, expired, or lacks access |
| 502 | `management_api_error` | Management API returned non-2xx |

## Authorization

**Admin only** — stricter than the Settings panels beside it, which use
`can_view_settings()`. This exposes organization billing posture, not project
data; a Viewer with Settings access has no business seeing how close the
account is to a quota breach. Checked server-side via `is_admin()` against the
caller's own JWT, never a service role — same pattern as
`upload-employee-photo` and `proximity-scan`.

## Two deliberate design decisions

**No polling, ever.** The client calls this when an admin opens Settings or
presses Refresh. A usage monitor on a timer would spend the very egress and
log-ingestion quota it reports on — precisely the class of bug this panel was
built to find. Do not add an interval.

**The response shape is treated as untrusted.** Supabase's Management API usage
endpoints are not covered by the stability guarantees the data APIs have, and
their payload shape has changed before. Rather than hard-depending on one
layout, the function probes several known key spellings per metric, maps what
it recognises, and returns `partial: true` with a note naming what it looked
for. A metric it cannot find comes back `null`, which the panel renders as
`—` — never `0`, which would read as "no egress" when it means "unknown".

`response_keys` echoes the top-level keys the API returned (keys only, never
values) so a shape change is diagnosable from the UI without redeploying the
function to discover what arrived.

## Related

- `Supabase/migrations/20261005120000_database_usage_rpc.sql` — the database half
- `JS/Utils/usage.js` — avg/day and projection arithmetic (`test/usage.test.mjs`)
- `docs/SUPABASE_QUOTA_DECISION.md` — why cumulative totals are the wrong thing to watch
