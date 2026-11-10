// Receives Viber Public Account callbacks, and exists almost entirely to
// learn subscriber ids.
//
// Viber has no `getUpdates`. The only way to discover who to send an alert
// to is to be told when they subscribe, so this records ids as they arrive
// and Settings offers them as a picker.
//
// WHY THIS CANNOT BE webhook.site. Viber posts `delivered` and `seen` for
// every message the bot sends, so a third-party endpoint would receive a
// running feed of when this site's alerts were delivered and read. Those two
// events are also the overwhelming majority of the traffic here, which is
// why they are discarded on the first line of the switch — before any
// database round trip, and without a log line.
//
// AUTHENTICATION IS THE SIGNATURE, not a shared secret. Viber signs every
// callback with HMAC-SHA256 of the raw body keyed by the bot's auth token,
// in X-Viber-Content-Signature. That is strictly better than the header
// secret notify-alert uses, because the token is never transmitted.

const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Length-independent compare. Signature material is attacker-supplied, so
// the early-exit a plain === gives is free to avoid.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureValid(token: string, rawBody: string, given: string | null): Promise<boolean> {
  if (!given) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return timingSafeEqual(hex(mac), given.toLowerCase());
}

type ViberUser = { id?: string; name?: string };
type ViberEvent = {
  event?: string;
  user?: ViberUser;
  sender?: ViberUser;
  user_id?: string;
};

async function upsertSubscriber(
  url: string,
  serviceKey: string,
  viberId: string,
  name: string | undefined,
  subscribed: boolean,
) {
  const res = await fetch(`${url}/rest/v1/viber_subscribers?on_conflict=viber_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      viber_id: viberId,
      // null rather than "" so an event with no name does not blank one we
      // already learned from an earlier event.
      name: name ?? null,
      subscribed,
      last_seen_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`subscriber upsert ${res.status}: ${detail.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  // Viber only ever POSTs. A GET here is a person or a scanner, not Viber.
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("VIBER_AUTH_TOKEN") ?? "";
  if (!token) {
    console.error("viber-webhook: VIBER_AUTH_TOKEN is not set");
    return json({ error: "not configured" }, 503);
  }

  // Read the body as text ONCE: the signature covers the exact bytes, so
  // re-serialising a parsed object would produce a different string and fail
  // to verify.
  const raw = await req.text();
  if (!await signatureValid(token, raw, req.headers.get("x-viber-content-signature"))) {
    // No log line. This endpoint's URL is effectively public once set as a
    // webhook, and logging rejections would let anyone inflate the log bill.
    return json({ error: "bad signature" }, 403);
  }

  let body: ViberEvent;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const event = String(body.event ?? "");

  // THE HOT PATH, and the reason it is first. `delivered` and `seen` arrive
  // roughly twice per message per recipient and carry nothing worth keeping.
  // Returning here costs one string compare and no database round trip.
  if (event === "delivered" || event === "seen" || event === "failed") {
    return json({ status: 0 });
  }

  // Viber's own validation ping when set_webhook is called. It must get a
  // 200 with status 0 or the webhook is rejected and the bot stays inert.
  if (event === "webhook") return json({ status: 0 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("viber-webhook: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return json({ error: "not configured" }, 503);
  }

  try {
    if (event === "subscribed" || event === "conversation_started") {
      // conversation_started fires when someone opens the chat, which is NOT
      // the same as subscribing — but it is the first moment their id is
      // known, and recording it is what lets an admin pick them before they
      // have sent anything.
      const u = body.user;
      if (u?.id) await upsertSubscriber(url, serviceKey, u.id, u.name, true);
    } else if (event === "message") {
      const s = body.sender;
      if (s?.id) await upsertSubscriber(url, serviceKey, s.id, s.name, true);
    } else if (event === "unsubscribed") {
      const id = body.user_id ?? body.user?.id;
      // Flagged, not deleted: a destination that quietly disappears from the
      // picker looks like a bug, and an admin should see that someone left.
      if (id) await upsertSubscriber(url, serviceKey, id, undefined, false);
    }
  } catch (e) {
    console.error(`viber-webhook: ${event} — ${e instanceof Error ? e.message : String(e)}`);
    // Still 200. A non-2xx makes Viber retry, and repeated failures make it
    // unset the webhook entirely — which would silently break subscriber
    // discovery for good.
    return json({ status: 0 });
  }

  // Success prints nothing; Viber requires a 200 with status 0.
  return json({ status: 0 });
});
