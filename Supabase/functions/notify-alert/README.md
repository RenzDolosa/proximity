# `notify-alert`

Pushes a newly-recorded alert to every enabled row in `alert_channels`.
**Viber** is the primary transport; Telegram is kept as a working fallback
(the channel column already abstracted it, so leaving it in costs nothing).
`email` is accepted by the schema and rejected here, loudly, rather than
counted as delivered.

> ### Viber's two traps
>
> **1. It returns HTTP 200 on failure.** An unsubscribed recipient, a bad
> token and a malformed id all come back `200 OK`. The real outcome is the
> `status` field in the body — `0` is success, anything else is not.
> Checking only `res.ok` reports every failure as delivered.
>
> **2. You cannot message someone who has not subscribed.** A Public Account
> can only message people who have opened a chat with it. There is no way to
> look an id up on demand — no `getUpdates` equivalent — which is the entire
> reason the [`viber-webhook`](../viber-webhook/README.md) function and the
> `viber_subscribers` table exist.

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
supabase secrets set VIBER_AUTH_TOKEN="<from partners.viber.com>"
```

`TELEGRAM_BOT_TOKEN` is only needed if you keep a Telegram row in
`alert_channels`. A missing token fails just that channel, not the request.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

The **same** `NOTIFY_ALERT_SECRET` value goes into Vault so the trigger can
send it:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-alert', 'notify_alert_url');
select vault.create_secret('<the same long random string>', 'notify_alert_secret');
```

## Setting up Viber

1. Create a **Public Account** at [partners.viber.com](https://partners.viber.com).
   A personal Viber account is not enough — the bot API only works for a PA.
2. Copy its **auth token** and set it as `VIBER_AUTH_TOKEN` on *both*
   functions.
3. Deploy `viber-webhook`, then point Viber at it **once**:

   ```bash
   curl -X POST https://chatapi.viber.com/pa/set_webhook \
     -H "X-Viber-Auth-Token: $VIBER_AUTH_TOKEN" \
     -d '{"url":"https://<ref>.supabase.co/functions/v1/viber-webhook",
          "event_types":["subscribed","unsubscribed","conversation_started","message"]}'
   ```

   A `{"status":0}` back means Viber accepted it. **Until this succeeds the
   PA is inert** and no id can ever be discovered.
4. Send each person the PA's share link. When they open the chat, their name
   appears in **Settings → Notifications**.
5. Pick them from the list and save.

`event_types` deliberately omits `delivered` and `seen`. The function
discards them anyway, but not subscribing to them avoids ~2 pointless
invocations per message per recipient.

## Getting a Telegram chat id (fallback only)

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
| `viber status 6` | the recipient has not subscribed to the Public Account. The commonest failure, and the one that looks like a bug |
| `viber status 2` | malformed request — usually an id pasted with whitespace |
| `viber status 1` / `invalid auth token` | `VIBER_AUTH_TOKEN` wrong, or set on `notify-alert` but not `viber-webhook` |
| subscriber list stays empty | `set_webhook` never succeeded, or it points at the wrong project ref |
| `403 bot can't initiate conversation` | Telegram fallback: nobody has messaged the bot yet |
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
