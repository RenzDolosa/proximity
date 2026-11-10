# `viber-webhook`

Receives Viber Public Account callbacks. It exists for one reason: **Viber
has no way to look up a subscriber id on demand.** There is no `getUpdates`,
no directory, no search. The only moment an id is knowable is when Viber
posts a callback, so this records them into `viber_subscribers` and
**Settings → Notifications** offers them as a picker.

> ### Why this cannot be webhook.site
>
> The obvious shortcut is to point `set_webhook` at a throwaway endpoint,
> read one id, and move on. Don't. Viber also posts `delivered` and `seen`
> for every message the bot sends, so a third-party endpoint would receive a
> running feed of **when this site's alerts were delivered and read**. The
> webhook has to be ours.

## Request

Viber POSTs JSON and signs it with `X-Viber-Content-Signature` —
HMAC-SHA256 of the **raw body**, keyed by the bot's auth token. That is the
authentication; there is no shared secret, and the token is never
transmitted.

The body is read as text once and verified before parsing. Re-serialising a
parsed object produces different bytes and never verifies.

| event | effect |
|---|---|
| `webhook` | Viber's validation ping. Answered `{"status":0}` — **until this succeeds the PA is inert** |
| `subscribed` | upsert, `subscribed = true` |
| `conversation_started` | upsert, `subscribed = true`. Not the same as subscribing, but it is the first moment the id is known |
| `message` | upsert from `sender`, `subscribed = true` |
| `unsubscribed` | **flagged**, not deleted — a destination that silently vanishes from the picker looks like a bug |
| `delivered` / `seen` / `failed` | discarded on the first line, before any env read or database round trip |

## Response

Always `200` with `{"status":0}`, **including when the upsert failed.** A
non-2xx makes Viber retry, and repeated failures make it **unset the webhook
entirely** — which would end subscriber discovery permanently and look like
nothing at all. Failures are logged instead.

Exceptions: `403` for a bad signature (no log line — this URL is effectively
public once registered, and logging rejections would let anyone inflate the
log bill), `405` for anything but POST, `503` for a missing secret.

## Deploying

> ### ⚠️ JWT verification must be OFF for this function too
>
> Viber posts callbacks with its own `X-Viber-Content-Signature` and no
> `Authorization` header. With JWT verification on, Supabase returns 401
> before this code runs — and Viber, seeing repeated failures, **unsets the
> webhook**, which ends subscriber discovery permanently and silently.
>
> Dashboard → Edge Functions → `viber-webhook` → **Settings** → turn off
> *Verify JWT*. The HMAC signature check is the replacement, and it is
> stronger than a bearer token because the secret is never transmitted.

**Dashboard (no CLI):** Edge Functions → *Deploy a new function* → *Via
editor*, name it `viber-webhook`, paste `index.ts`, deploy, turn off Verify
JWT, **then** run `set_webhook` below. Registering before the function is
live makes Viber reject the URL.

**CLI:**

```bash
npx supabase@latest functions deploy viber-webhook --project-ref <ref> --no-verify-jwt
```

## Secrets

Dashboard: Edge Functions → **Secrets**. Or:

```bash
npx supabase@latest secrets set VIBER_AUTH_TOKEN="<from partners.viber.com>"
```

The **same** token as `notify-alert`: it is both the send credential and the
signing key. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected.

## Registering it

```bash
curl -X POST https://chatapi.viber.com/pa/set_webhook \
  -H "X-Viber-Auth-Token: $VIBER_AUTH_TOKEN" \
  -d '{"url":"https://<ref>.supabase.co/functions/v1/viber-webhook",
       "event_types":["subscribed","unsubscribed","conversation_started","message"]}'
```

`event_types` omits `delivered` and `seen` on purpose. The function discards
them regardless, but not subscribing avoids ~2 pointless invocations per
message per recipient.

## Cost

| | per day |
|---|---|
| subscribe / conversation events | a handful, ever |
| receipts (if `event_types` is left at its default) | ~2 × alerts × recipients ≈ 16 |
| invocations with the recommended `event_types` | ~0 |

## Rollback

```bash
curl -X POST https://chatapi.viber.com/pa/set_webhook \
  -H "X-Viber-Auth-Token: $VIBER_AUTH_TOKEN" -d '{"url":""}'
```

An empty URL removes the webhook. Already-saved destinations keep working —
`notify-alert` reads `alert_channels`, not this table. Only discovery of
*new* subscribers stops.
