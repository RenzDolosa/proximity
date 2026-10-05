# `project-usage` Edge Function

Backs **Settings → Usage**. Returns this project's billing-cycle usage for
Egress, Cached Egress, Log Ingestion and Log Query.

## Why this is a function and not an RPC

Those four are **platform billing metrics**. They are not in the database and
no RPC can reach them — they exist only in Supabase's Management API at
`api.supabase.com`, which authenticates with a Personal Access Token.

That token is an **account-wide credential**: it can read and modify every
project in every organization the issuing user belongs to, including deleting
them. It cannot sit in client JavaScript behind an anon key. So the token lives
here as an Edge Function secret, the browser calls this function, and the
browser never sees the token and never talks to `api.supabase.com`.

The fifth figure on the panel, **Database size**, deliberately does *not* come
from here. `pg_database_size()` is readable from inside the database, so
`get_database_usage()` provides it at no token and no external call. That split
is also why the panel still shows something useful when this function is
unconfigured.

## Setup

Two secrets, neither committed:

| Secret | Value |
|---|---|
| `SUPABASE_MANAGEMENT_TOKEN` | Personal Access Token from [account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | this project's ref, e.g. `kjwttqmbcjvkivgmwuev` |

```bash
supabase secrets set SUPABASE_MANAGEMENT_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=kjwttqmbcjvkivgmwuev
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform.

Until both are set the function returns `503 { code: "not_configured" }`, and
the panel says so explicitly rather than showing a generic error — a one-time
setup task and an incident should not look alike.

**Treat the token as a credential with blast radius well beyond this project.**
Scope it to the smallest account that can read this project's usage, rotate it
on staff change, and never put it anywhere a browser can reach.

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
