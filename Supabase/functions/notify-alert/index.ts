// Pushes a newly-recorded alert to every enabled channel.
//
// Called by the trg_alerts_notify trigger via pg_net (see migration
// 20261110092000), never by a browser. There is no CORS handling here on
// purpose: nothing in the frontend should be able to reach this, and the
// absence of an Access-Control-Allow-Origin header is part of that.
//
// LOGGING POLICY, which is a cost decision on this project. Success paths
// print NOTHING. Every console line becomes a function_edge_logs row against
// a 1 GB monthly budget that is already in a billing grace period, and "we
// sent a message" is not worth paying for. Failures print once, with enough
// to act on and without the chat id.

const TELEGRAM_API = "https://api.telegram.org";

type AlertPayload = {
  id?: string;
  kind?: string;
  severity?: string;
  message?: string;
  created_at?: string;
};

type Channel = {
  id: string;
  kind: string | null;
  channel: string;
  target: string;
};

const SEVERITY_PREFIX: Record<string, string> = {
  critical: "\u{1F534}",
  warning: "\u{1F7E0}",
  info: "\u{1F535}",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time-ish comparison. The secret is high-entropy and this endpoint
// is not reachable from a browser, so a timing oracle here is close to
// theoretical — but an early-exit `!==` on a secret is the kind of thing that
// is free to avoid and awkward to explain later.
function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function formatMessage(alert: AlertPayload): string {
  const mark = SEVERITY_PREFIX[String(alert.severity ?? "")] ?? "";
  const kind = String(alert.kind ?? "alert").replace(/_/g, " ");
  const when = alert.created_at
    ? new Date(alert.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })
    : "";
  // Plain text, no parse_mode. A scanner label is user-supplied data, and
  // Markdown parsing would let an underscore or asterisk in a label either
  // mangle the message or make Telegram reject it outright.
  return [
    `${mark} Proximity — ${kind}`.trim(),
    alert.message ?? "",
    when ? `at ${when}` : "",
  ].filter(Boolean).join("\n");
}

async function sendTelegram(token: string, chatId: string, text: string) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_notification: false }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // The chat id is deliberately absent: these logs are readable by anyone
    // with project access and the id is the sensitive half of the pair.
    throw new Error(`telegram ${res.status}: ${detail.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("NOTIFY_ALERT_SECRET") ?? "";
  if (!expected) {
    console.error("notify-alert: NOTIFY_ALERT_SECRET is not set");
    return json({ error: "not configured" }, 503);
  }
  if (!secretMatches(req.headers.get("x-notify-secret"), expected)) {
    // No console line. An unauthenticated caller hammering this endpoint
    // would otherwise be able to inflate the log bill by itself.
    return json({ error: "forbidden" }, 403);
  }

  let alert: AlertPayload;
  try {
    alert = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("notify-alert: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    return json({ error: "not configured" }, 503);
  }

  // Read the destinations with the service role rather than trusting the
  // trigger to send them: the request body crosses a network boundary, and
  // a payload that could name its own delivery target would turn a leaked
  // shared secret into an open relay.
  const channelsRes = await fetch(
    `${url}/rest/v1/alert_channels?select=id,kind,channel,target&enabled=eq.true`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!channelsRes.ok) {
    console.error(`notify-alert: channel lookup failed (${channelsRes.status})`);
    return json({ error: "channel lookup failed" }, 502);
  }
  const all = (await channelsRes.json()) as Channel[];
  const channels = all.filter((c) => c.kind === null || c.kind === alert.kind);
  if (channels.length === 0) return json({ sent: 0 });

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const text = formatMessage(alert);
  let sent = 0;
  const failures: string[] = [];

  // Sequential, not Promise.all. Telegram rate-limits per bot, and with a
  // handful of channels the latency difference is irrelevant next to being
  // predictable about the order things are attempted in.
  for (const c of channels) {
    try {
      if (c.channel === "telegram") {
        if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
        await sendTelegram(token, c.target, text);
        sent++;
      } else {
        // Accepted by the schema so the column can grow into it, rejected
        // loudly here rather than counted as delivered.
        throw new Error(`channel not implemented: ${c.channel}`);
      }
    } catch (e) {
      failures.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failures.length) {
    console.error(`notify-alert: ${failures.length} of ${channels.length} failed — ${failures.join("; ")}`);
    // 207: some went out. A 5xx would make pg_net retry and re-deliver to
    // the channels that already succeeded.
    return json({ sent, failed: failures.length }, sent > 0 ? 207 : 502);
  }

  // The success path prints nothing. See the note at the top of this file.
  return json({ sent });
});
