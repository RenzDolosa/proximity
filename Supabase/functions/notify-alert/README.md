# `notify-alert`

Pushes a newly-recorded alert to every enabled row in `alert_channels`.
Telegram today; the schema accepts `email` so the column can grow into it
without a migration.

Called by the `trg_alerts_notify` trigger on `public.alerts` via `pg_net`
(migration `20261110092000`). **Never called by a browser** — there is no
CORS handling, deliberately.

## Request

```
POST /functions/v1/notify-alert
Content-Type: application/json
x-notify-secret: <the shared secret>
```

```json
{
  "id": "uuid",
  "kind": "scanner_went_silent",
  "severity": "warning",
  "message": "Krus3K Scanner 1 has not reported in over 60 minutes",
  "created_at": "2026-11-10T09:00:00.000Z"
}
```

`kind` selects which channels receive it: a row with `kind = null` takes
everything, a row with a matching `kind` takes just that one.

**The body cannot name its own destination.** Targets are read server-side
with the service role, so a leaked shared secret gets you an unwanted
Telegram message to an already-configured chat — not an open relay.

## Response

| status | body | meaning |
|---|---|---|
| `200` | `{"sent": 2}` | delivered to every matching channel |
| `200` | `{"sent": 0}` | no enabled channel matched this kind — not an error |
| `207` | `{"sent": 1, "failed": 1}` | partial. **Not a 5xx on purpose:** pg_net would retry and re-deliver to the channel that already succeeded |
| `400` | `{"error": "invalid json"}` | unparseable body |
| `403` | `{"error": "forbidden"}` | missing or wrong `x-notify-secret` |
| `405` | `{"error": "method not allowed"}` | anything but POST |
| `502` | `{"error": "channel lookup failed"}` | PostgREST unreachable, or every channel failed |
| `503` | `{"error": "not configured"}` | a required secret is missing |

## Secrets

Set these yourself; none of them belong in the repo.

```bash
supabase secrets set NOTIFY_ALERT_SECRET="<a long random string>"
supabase secrets set TELEGRAM_BOT_TOKEN="<from @BotFather>"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

The **same** `NOTIFY_ALERT_SECRET` value goes into Vault so the trigger can
send it:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-alert', 'notify_alert_url');
select vault.create_secret('<the same long random string>', 'notify_alert_secret');
```

## Getting a Telegram chat id

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Send any message to your new bot, or add it to the group you want alerts in.
3. `curl https://api.telegram.org/bot<token>/getUpdates` and read
   `result[0].message.chat.id`. A group id is negative — keep the minus sign.
4. Paste it into **Settings → Notifications**.

A bot cannot start a conversation. If nobody has messaged it, `getUpdates`
returns an empty list and sends fail with `403 Forbidden: bot can't initiate
conversation with a user`.

## Logging

**Success prints nothing.** Each console line is a `function_edge_logs` row
against a 1 GB monthly budget, and at ~4 alerts/day a success line would buy
nothing. Failures print once, with the channel id and the upstream error —
**never the chat id or address**, since these logs are readable by anyone
with project access and the target is the sensitive half of the pair.

A wrong `x-notify-secret` also prints nothing, so an unauthenticated caller
cannot inflate the log bill by hammering the endpoint.

## Cost

| | per day |
|---|---|
| invocations | ~4 (alert rate after `20261110090000`) |
| `function_edge_logs` lines | ~4 |
| outbound egress | ~4 KB |

Before the silence-hours fix this would have been ~15/day, ~11 of them
overnight and none of them worth waking up for. The two changes are designed
together.

## Failure modes

| symptom | cause |
|---|---|
| nothing arrives, no log line | no enabled `alert_channels` row matches the kind — the trigger no-ops before calling |
| nothing arrives, `net._http_response` shows 403 | `NOTIFY_ALERT_SECRET` and the Vault `notify_alert_secret` have drifted |
| `403 bot can't initiate conversation` | nobody has messaged the bot yet (see above) |
| `400 chat not found` | wrong chat id, or a group id with the minus sign dropped |
| alerts recorded but never pushed | Vault secrets missing — the trigger returns silently by design |

Check what pg_net actually did:

```sql
select id, status_code, error_msg, created from net._http_response
order by created desc limit 5;
```

## Rollback

```sql
drop trigger if exists trg_alerts_notify on public.alerts;
```

Alerts keep being recorded and the Alerts page is unaffected; only the push
stops. The function can be left deployed — it costs nothing when nothing
calls it.
