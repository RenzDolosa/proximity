// project-usage Edge Function
//
// POST {} -> {
//   period_start, period_end,          // ISO strings, the current billing cycle
//   metrics: [{ key, label, value, limit, unit }],
//   partial: boolean,                  // true if some metrics could not be read
//   notes: string[]                    // why, when partial
// }
//
// WHY THIS FUNCTION EXISTS AT ALL
//
// Four of the five figures the Settings -> Usage panel shows (Egress, Log
// Ingestion, Log Query, Cached Egress) are platform BILLING metrics. They are
// not in the database and no RPC can reach them — they live only in Supabase's
// Management API at api.supabase.com, which authenticates with a Personal
// Access Token.
//
// That token is an ACCOUNT-WIDE credential: it can read and modify every
// project in every organization the issuing user belongs to, including
// deleting them. It is categorically not something that can sit in client
// JavaScript behind an anon key, which is why this is an Edge Function holding
// the token as a secret rather than a direct fetch from the browser. The
// browser never sees the token and never talks to api.supabase.com.
//
// The fifth figure, Database size, deliberately does NOT come from here — it
// is available from inside the database via get_database_usage(), so it costs
// no token and no external call. See that migration.
//
// Required Edge Function secret (set via `supabase secrets set` or the
// Dashboard, NOT committed) — just ONE:
//   MANAGEMENT_API_TOKEN   Personal Access Token from
//                          https://supabase.com/dashboard/account/tokens
//
// NOT named SUPABASE_MANAGEMENT_TOKEN: Supabase reserves the `SUPABASE_`
// prefix for the variables it injects itself and rejects user secrets using
// it ("Name must not start with the SUPABASE_ prefix").
//
// The project ref is DERIVED from the platform-injected SUPABASE_URL
// (https://<ref>.supabase.co) rather than stored as a second secret. One less
// thing to set, and — more usefully — it cannot drift: a hand-typed ref that
// disagrees with the project the function is actually running in would report
// some other project's usage with no visible error. MANAGEMENT_PROJECT_REF
// overrides it for the cases where the URL is not the ref (self-hosted, or a
// branch database whose usage you want attributed to the parent).
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform.
//
// A NOTE ON COST, WHICH IS THE WHOLE POINT OF THE PANEL
//
// This endpoint is deliberately on-demand only — the client calls it when an
// admin opens Settings or presses Refresh, and never on a timer. A usage
// monitor that polled would spend egress and log-ingestion quota in order to
// report on egress and log-ingestion quota, which is exactly the class of bug
// the panel was built to find. Do not add polling here.
//
// RESPONSE SHAPE IS TREATED AS UNTRUSTED
//
// Supabase's Management API usage endpoints are not covered by the same
// stability guarantees as the data APIs, and their payload shape has changed
// before. Rather than hard-depend on one layout, this function probes a small
// set of known shapes, maps whatever it recognises, and reports `partial: true`
// with a note for anything it could not find. A metric that cannot be read
// comes back as null — which the client renders as "—" — and never as 0, which
// would read as "no egress" when it means "unknown".
import { createClient } from "jsr:@supabase/supabase-js@2";

const MANAGEMENT_API = "https://api.supabase.com";

type Metric = {
  key: string;
  label: string;
  value: number | null;
  limit: number | null;
  unit: "bytes" | "count";
};

// The five the Settings panel asks for, in display order. `db_size` is filled
// in client-side from get_database_usage(); it is listed here only so the
// ordering lives in one place.
const WANTED: Array<{ key: string; label: string; unit: "bytes" | "count"; apiKeys: string[] }> = [
  { key: "egress", label: "Egress", unit: "bytes", apiKeys: ["egress", "total_egress", "db_egress"] },
  { key: "cached_egress", label: "Cached Egress", unit: "bytes", apiKeys: ["cached_egress", "total_cached_egress"] },
  { key: "log_ingestion", label: "Log Ingestion", unit: "bytes", apiKeys: ["log_drain_events", "log_ingestion", "total_log_ingestion"] },
  { key: "log_query", label: "Log Query", unit: "bytes", apiKeys: ["log_query", "total_log_query"] },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Explicit override first, then derive from the injected SUPABASE_URL. See the
// header for why deriving beats a second hand-typed secret.
function projectRef(): string | null {
  const explicit = Deno.env.get("MANAGEMENT_PROJECT_REF");
  if (explicit) return explicit.trim();
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return null;
  try {
    const host = new URL(url).hostname;      // <ref>.supabase.co
    const ref = host.split(".")[0];
    // A local `supabase start` stack serves 127.0.0.1/localhost, which has no
    // ref at all — return null so the caller reports "not configured" rather
    // than querying the Management API for a project named "127".
    return ref && !/^(localhost|\d+)$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Pulls a number out of whatever shape the entry happens to be. The usage
// endpoints have historically returned both bare numbers and
// { usage, limit } objects for the same field, so handle both rather than
// betting on one.
function readMetric(raw: unknown): { value: number | null; limit: number | null } {
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, limit: null };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const pick = (...names: string[]) => {
      for (const n of names) {
        const v = o[n];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return null;
    };
    return { value: pick("usage", "value", "total", "used"), limit: pick("limit", "quota", "included") };
  }
  return { value: null, limit: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Scoped to the caller's own JWT, never a service role — the role check
    // below evaluates against THIS user. Same pattern as
    // upload-employee-photo and proximity-scan.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Admin only, deliberately stricter than the panel's sibling panels. This
    // exposes organization-level billing posture, not project data: a Viewer
    // with Settings access has no business seeing how close the account is to
    // a quota breach.
    const { data: allowed, error: roleErr } = await supabase.rpc("is_admin");
    if (roleErr) return json({ error: roleErr.message }, 400);
    if (!allowed) return json({ error: "Only admins can view project usage." }, 403);

    const token = Deno.env.get("MANAGEMENT_API_TOKEN");
    const ref = projectRef();
    if (!token || !ref) {
      return json({
        error: !token
          ? "Project usage isn't configured yet — set the MANAGEMENT_API_TOKEN Edge Function secret. See Supabase/functions/project-usage/README.md."
          : "Could not determine the project ref from SUPABASE_URL. Set MANAGEMENT_PROJECT_REF explicitly.",
        code: "not_configured",
      }, 503);
    }

    // Usage/billing is NOT in Supabase's published Management API surface.
    // Verified 2026-10-05 against https://api.supabase.com/api/v1-json: no
    // path mentions usage, billing, quota, analytics or logs, and
    // /v1/projects/{ref}/billing/usage — the first thing tried here —
    // answered 404 against the live project.
    //
    // So rather than guess a second path and ship another 404, probe a small
    // ordered set and report exactly what each one answered. One deploy then
    // produces a definitive answer for THIS account instead of more
    // speculation, and `probes` below is returned to the UI either way so the
    // result is visible without reading function logs.
    //
    // Organization-scoped candidates come first on the reasoning that the
    // dashboard presents usage at organization level ("Organization is on the
    // Free Plan", an All-projects filter), so if an endpoint exists at all it
    // is more likely to be org-scoped than project-scoped.
    const probes: Array<{ path: string; status: number | string }> = [];

    // The org id is needed for the org-scoped candidates. Failure here is not
    // fatal — the project-scoped candidates still get tried.
    let orgId: string | null = null;
    try {
      const projRes = await fetch(`${MANAGEMENT_API}/v1/projects/${ref}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      probes.push({ path: `/v1/projects/${ref}`, status: projRes.status });
      if (projRes.ok) {
        const proj = await projRes.json();
        orgId = proj?.organization_id ?? proj?.organization_slug ?? null;
      }
    } catch (e) {
      probes.push({ path: `/v1/projects/${ref}`, status: String(e) });
    }

    const candidates = [
      ...(orgId
        ? [
          `/v1/organizations/${orgId}/usage`,
          `/v1/organizations/${orgId}/billing/usage`,
          `/v1/organizations/${orgId}/daily-stats`,
        ]
        : []),
      `/v1/projects/${ref}/usage`,
      `/v1/projects/${ref}/billing/usage`,
    ];

    let res: Response | null = null;
    for (const path of candidates) {
      try {
        const attempt = await fetch(`${MANAGEMENT_API}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        probes.push({ path, status: attempt.status });
        // 401/403 is about the TOKEN, not the path — stop and report it,
        // because trying further paths would just repeat the same rejection
        // and bury the one message that tells the operator what to fix.
        if (attempt.status === 401 || attempt.status === 403) { res = attempt; break; }
        if (attempt.ok) { res = attempt; break; }
      } catch (e) {
        probes.push({ path, status: String(e) });
      }
    }

    if (!res) {
      return json({
        error:
          "No usage endpoint responded. Supabase's published Management API has no usage/billing path, so these four metrics may simply not be fetchable — read them from the dashboard's Usage page instead. Database size below is unaffected.",
        code: "no_usage_endpoint",
        probes,
      }, 501);
    }

    if (res.status === 401 || res.status === 403) {
      // A revoked, expired or under-scoped token is a human fix, not something
      // a retry helps with — flag it distinctly so the UI can say so.
      //
      // Scoped tokens report exactly which permission is absent, e.g.
      //   {"message":"Missing required permission(s): edge_functions_read",
      //    "error":{"missing_permissions":["edge_functions_read"]}}
      // Passing that through turns "it says no" into "tick this box", which is
      // the difference between a five-minute fix and an afternoon of guessing
      // at a permission matrix. Observed from the CLI's own deploy failure.
      let detail = "";
      try {
        const body = await res.json();
        const missing = body?.error?.missing_permissions;
        if (Array.isArray(missing) && missing.length) {
          detail = ` Missing permission(s): ${missing.join(", ")}. Add them to this token's scope at https://supabase.com/dashboard/account/tokens (or issue a new token with them and update the MANAGEMENT_API_TOKEN secret).`;
        } else if (typeof body?.message === "string") {
          detail = ` ${body.message}`;
        }
      } catch {
        // non-JSON body — the generic message below still applies
      }
      return json({
        error: `Supabase rejected the management token (HTTP ${res.status}): revoked, expired, or missing a permission.${detail}`,
        code: "management_token_invalid",
      }, 503);
    }
    if (!res.ok) {
      return json({ error: `Management API returned ${res.status}`, code: "management_api_error", probes }, 502);
    }

    const payload = await res.json();

    // Shape-tolerant extraction. `usages` is the shape seen most recently;
    // a flat object keyed by metric name is the older one.
    const bag: Record<string, unknown> = {};
    if (Array.isArray(payload?.usages)) {
      for (const u of payload.usages) {
        if (u && typeof u.metric === "string") bag[u.metric.toLowerCase()] = u;
      }
    }
    if (payload && typeof payload === "object") {
      for (const [k, v] of Object.entries(payload)) {
        if (k !== "usages" && !(k in bag)) bag[k.toLowerCase()] = v;
      }
    }

    const notes: string[] = [];
    const metrics: Metric[] = WANTED.map(({ key, label, unit, apiKeys }) => {
      for (const candidate of apiKeys) {
        if (candidate in bag) {
          const { value, limit } = readMetric(bag[candidate]);
          if (value !== null) return { key, label, value, limit, unit };
        }
      }
      notes.push(`No value for "${label}" in the Management API response (looked for: ${apiKeys.join(", ")}).`);
      return { key, label, value: null, limit: null, unit };
    });

    return json({
      period_start: payload?.period_start ?? payload?.current_period_start ?? null,
      period_end: payload?.period_end ?? payload?.current_period_end ?? null,
      metrics,
      partial: notes.length > 0,
      notes,
      // Echoed so a shape change is diagnosable from the UI without needing to
      // redeploy the function to find out what came back. Keys only — never
      // values, which could carry account detail beyond this project.
      response_keys: Object.keys(bag).sort(),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
