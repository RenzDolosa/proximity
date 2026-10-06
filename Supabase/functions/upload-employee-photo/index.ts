// upload-employee-photo Edge Function
//
// POST { action: "upload", image_base64, filename, mime_type?, old_file_id?,
//        thumb_base64?, thumb_mime_type? }
//   -> { url, file_id, thumb_b64 }
//   thumb_b64 is normally an echo of the caller's ~400px .webp thumbnail
//   (Utils/image.js's fileToOfflineThumbWebp) for storing as
//   employees.photo_thumb_b64. Falls back to a server-side Drive thumbnail fetch
//   when the client sends none, which is NOT guaranteed .webp. null if neither
//   worked — logged, but never fails the upload.
// POST { action: "delete", old_file_id } -> { ok: true }
// POST { action: "quota" } -> { usage, limit, usageInDrive }
//   Drive's own about.get. `limit` is null for uncapped Workspace accounts, so
//   the client can tell "unlimited" from "full". Read by Settings.
//
// Errors: { error, code? }. `code` marks failures no retry can fix:
//   503 google_reauth_required — invalid_grant: the refresh token is revoked or
//        expired (a consent screen left in "Testing" caps them at 7 days). Only
//        a human re-consenting can replace it; see README.
//   503 google_client_invalid — invalid_client/unauthorized_client: the OAuth
//        client itself was deleted or its secret rotated.
//
// Auth is per-action, both re-checked against the caller's own JWT, never a
// service role: "quota" is read-only so can_view_settings() suffices (Viewers
// included), while "upload"/"delete" write to Drive and need
// is_admin_or_manager().
//
// mime_type must be the ACTUAL type of image_base64 — canvas.toBlob() can
// silently produce a different format than requested, so neither side may assume
// .webp.
//
// Storage is Google Drive via a real account's OAuth refresh token, NOT a service
// account: service accounts have no storage quota of their own and can only write
// to Shared Drives or use domain-wide delegation, both of which need paid
// Workspace. Required secrets (set in the Dashboard, never committed):
// GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN,
// GOOGLE_DRIVE_FOLDER_ID. See this folder's README for the one-time setup.

import { createClient } from "jsr:@supabase/supabase-js@2";

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Keep in sync with JS/Utils/image.js's EXTENSION_BY_MIME — the client
// converts to whichever of these the browser's canvas encoder actually
// produced (usually webp, but not guaranteed) and tells us which one via
// mime_type; this is just the server-side mirror for picking a filename
// extension + Content-Type that actually matches those bytes.
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401, cors);

    // Scoped to the caller's own JWT — RLS and the RPC checks below
    // evaluate against THIS user, never a service role.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const body = await req.json();
    const action = body.action;

    // "quota" is read-only, so it only needs Settings *view* access
    // (can_view_settings() — true for Viewers with a covering access_scope
    // too, not just admins/managers). "upload"/"delete" actually write to
    // Drive, so they need the stricter is_admin_or_manager().
    const rpcName = action === "quota" ? "can_view_settings" : "is_admin_or_manager";
    const { data: allowed, error: roleErr } = await supabase.rpc(rpcName);
    if (roleErr) return json({ error: roleErr.message }, 400, cors);
    if (!allowed) {
      const message = action === "quota"
        ? "You don't have access to Settings."
        : "Only admins and managers can manage employee photos.";
      return json({ error: message }, 403, cors);
    }

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
    if (!clientId || !clientSecret || !refreshToken || !folderId) {
      return json({ error: "Google Drive isn't configured yet — GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, and GOOGLE_DRIVE_FOLDER_ID must be set as Edge Function secrets." }, 500, cors);
    }
    const accessToken = await getCachedGoogleAccessToken(clientId, clientSecret, refreshToken);

    if (action === "delete") {
      if (body.old_file_id) await deleteDriveFile(body.old_file_id, accessToken); // best-effort
      return json({ ok: true }, 200, cors);
    }

    if (action === "quota") {
      const quota = await getDriveStorageQuota(accessToken);
      return json(quota, 200, cors);
    }

    if (action === "upload") {
      const { image_base64, filename, mime_type, old_file_id, thumb_base64, thumb_mime_type } = body;
      if (!image_base64 || typeof image_base64 !== "string") {
        return json({ error: "image_base64 is required" }, 400, cors);
      }
      const bytes = base64ToBytes(image_base64);
      if (bytes.length > 8 * 1024 * 1024) {
        return json({ error: "Photo is too large (max 8MB)." }, 400, cors);
      }

      // Trust the mime type the client actually produced, not .webp — see the
      // header. Defaults to webp only when an older client omits it.
      const contentType = typeof mime_type === "string" && EXTENSION_BY_MIME[mime_type] ? mime_type : "image/webp";
      const ext = EXTENSION_BY_MIME[contentType];

      const safeName = (filename || "employee-photo").replace(/[^a-zA-Z0-9._-]/g, "_");

      // Deleting the old photo needs nothing from the new upload, so it runs
      // concurrently — and since it is already best-effort, hand it to
      // EdgeRuntime.waitUntil so it leaves the response path entirely. Falls back
      // to a bounded await where that global is unavailable.
      let deleteOldPromise: Promise<void> = Promise.resolve();
      if (old_file_id) {
        deleteOldPromise = deleteDriveFile(old_file_id, accessToken);
        const bg = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (bg?.waitUntil) {
          bg.waitUntil(deleteOldPromise);
          deleteOldPromise = Promise.resolve(); // already handed off — don't also await it below
        }
      }

      // A random suffix keeps Drive filenames unique even when the caller reuses
      // a base name (employee_code is recycled after a resignation).
      const fileId = await uploadToDrive(bytes, `${safeName}-${crypto.randomUUID().slice(0, 8)}.${ext}`, contentType, folderId, accessToken);
      await makeFilePublic(fileId, accessToken); // "anyone with the link can view"
      await deleteOldPromise; // no-op if EdgeRuntime.waitUntil already took it, otherwise waits for the best-effort delete

      // Prefer the client's own .webp thumbnail over fetching one. Sanity-checked
      // rather than trusted: a bloated value here would ride along in every
      // kiosk's photo sync forever.
      const MAX_CLIENT_THUMB_BYTES = 1 * 1024 * 1024;
      let thumbB64: string | null = null;
      if (typeof thumb_base64 === "string" && thumb_base64.length > 0) {
        try {
          const thumbBytes = base64ToBytes(thumb_base64);
          if (thumbBytes.length > 0 && thumbBytes.length <= MAX_CLIENT_THUMB_BYTES) {
            thumbB64 = thumb_base64;
          } else {
            console.warn(`Client-supplied offline thumbnail for Drive file ${fileId} was ${thumbBytes.length} bytes (mime ${thumb_mime_type || "unknown"}) — outside the expected range, falling back to a server-side fetch.`);
          }
        } catch {
          console.warn(`Client-supplied offline thumbnail for Drive file ${fileId} wasn't valid base64 — falling back to a server-side fetch.`);
        }
      }

      // Fallback for a client that sent no thumbnail, or whose conversion failed.
      // w400 matches OFFLINE_THUMB_MAX_DIMENSION so a fallback thumbnail is no
      // blurrier than a client one on the kiosk's full-screen photo stage.
      //
      // Timed out because Drive's thumbnail generation can lag an upload it just
      // received by a second or more, and that lag sat directly in every upload's
      // response time. A timeout just yields null, like any best-effort failure.
      if (thumbB64 === null) {
        const THUMB_FETCH_TIMEOUT_MS = 2500;
        try {
          const thumbRes = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w400`, {
            signal: AbortSignal.timeout(THUMB_FETCH_TIMEOUT_MS),
          });
          if (thumbRes.ok) {
            thumbB64 = bytesToBase64(new Uint8Array(await thumbRes.arrayBuffer()));
          } else {
            console.warn(`Offline-thumbnail fetch for Drive file ${fileId} returned HTTP ${thumbRes.status} — photo_thumb_b64 will be null for this employee.`);
          }
        } catch (thumbErr) {
          // The photo is already uploaded and public by now; a missing thumbnail
          // only costs this one employee their offline photo, so it must never
          // fail the upload. Covers both the timeout and any network error.
          console.warn(`Offline-thumbnail fetch for Drive file ${fileId} threw (or timed out after ${THUMB_FETCH_TIMEOUT_MS}ms) — photo_thumb_b64 will be null for this employee.`, thumbErr);
        }
      }

      // /thumbnail, NOT uc?export=view: the latter is deprecated for hot-linking
      // and returns a download interstitial rather than raw bytes for webp, which
      // is why avatars broke once uploads started sending real webp. w512 is
      // plenty for a 44-64px avatar on a retina display.
      const url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w512`;
      return json({ url, file_id: fileId, thumb_b64: thumbB64 }, 200, cors);
    }

    return json({ error: `Unknown action "${action}"` }, 400, cors);
  } catch (err) {
    // 503 (upstream credential problem), not 500 (our bug): nothing is wrong
    // with this function or the caller's request, and a stable `code` lets
    // the UI show "re-authorize Google Drive" instead of a raw Google string.
    if (err instanceof GoogleAuthError) {
      return json({ error: err.message, code: err.code }, 503, cors);
    }
    return json({ error: (err as Error).message }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// A failure of the stored Google credentials themselves (as opposed to a
// transient network/API error), carrying a stable machine-readable `code`.
class GoogleAuthError extends Error {
  code: "google_reauth_required" | "google_client_invalid";
  constructor(code: "google_reauth_required" | "google_client_invalid", message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

// ---- Google OAuth (refresh token -> short-lived access token) ----

// Module-scope, not per-request: a warm function instance reuses this across
// invocations arriving close together, so a burst of uploads does not each pay a
// full token round trip on the critical path. Access tokens last an hour. Keyed
// by the refresh token it was issued for, so rotating that env var misses the
// cache instead of serving a token for the wrong account.
let cachedToken: { accessToken: string; expiresAt: number; forRefreshToken: string } | null = null;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000; // refresh a minute early rather than risk a request landing right at expiry

async function getCachedGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  if (cachedToken && cachedToken.forRefreshToken === refreshToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }
  const { accessToken, expiresInSeconds } = await getGoogleAccessToken(clientId, clientSecret, refreshToken);
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + (expiresInSeconds * 1000) - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    forRefreshToken: refreshToken,
  };
  return accessToken;
}

async function getGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  // .catch so a non-JSON body (proxy/HTML error page) cannot mask the real status.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const googleError = String(data.error || "");
    // Google's own wording goes to the logs (no secrets in it); the browser gets
    // the friendlier message below.
    console.error(`Google token refresh failed (HTTP ${res.status}): ${googleError || "no error code"} — ${data.error_description || "no description"}`);
    // invalid_grant means the refresh token is dead and no server-side call can
    // mint a replacement — Google requires interactive consent.
    if (googleError === "invalid_grant") {
      throw new GoogleAuthError(
        "google_reauth_required",
        "Google Drive access has expired or was revoked. An admin needs to re-authorize the connection (see Supabase/functions/upload-employee-photo/README.md → \"Refresh token stops working?\").",
      );
    }
    if (googleError === "invalid_client" || googleError === "unauthorized_client") {
      throw new GoogleAuthError(
        "google_client_invalid",
        "Google rejected this app's OAuth client credentials. An admin needs to check GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (see Supabase/functions/upload-employee-photo/README.md).",
      );
    }
    throw new Error(data.error_description || googleError || `Google authentication failed (HTTP ${res.status}).`);
  }
  // The conservative 1800s fallback means a missing expires_in costs an extra
  // refresh, never a token served past its real expiry.
  return { accessToken: data.access_token, expiresInSeconds: Number(data.expires_in) || 1800 };
}

// ---- Drive API ----

async function uploadToDrive(bytes: Uint8Array, name: string, contentType: string, folderId: string, accessToken: string): Promise<string> {
  const boundary = "proximity-photo-" + crypto.randomUUID();
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    encoder.encode(`\r\n--${boundary}--`),
  ];
  const bodyBytes = concatBytes(parts);

  const res = await fetch(`${DRIVE_UPLOAD_URL}&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: bodyBytes,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Google Drive upload failed.");
  return data.id;
}

async function makeFilePublic(fileId: string, accessToken: string) {
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Could not make the photo viewable.");
  }
}

// Drive omits `limit` entirely for uncapped accounts rather than sending 0, so
// it stays null here — the client must be able to tell "unlimited" from "full".
async function getDriveStorageQuota(accessToken: string): Promise<{ usage: number; limit: number | null; usageInDrive: number }> {
  const res = await fetch(`${DRIVE_ABOUT_URL}?fields=storageQuota`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Could not read Google Drive storage quota.");
  const q = data.storageQuota || {};
  return {
    usage: Number(q.usage || 0),
    limit: q.limit != null ? Number(q.limit) : null,
    usageInDrive: Number(q.usageInDrive || 0),
  };
}

async function deleteDriveFile(fileId: string, accessToken: string) {
  try {
    await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Best-effort: an orphaned Drive file is a non-issue, and cleanup of the OLD
    // photo must never fail the caller's request.
  }
}

// ---- base64 helper (Deno has no Buffer) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Chunked so String.fromCharCode(...bytes) cannot blow the call stack. Not a
// real risk at thumbnail size, but cheap insurance.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Return type deliberately NOT annotated as `Uint8Array`: on Deno/TS 5.7+ that
// means Uint8Array<ArrayBufferLike>, which fetch()'s BodyInit rejects. Annotating
// it made `deno check` fail in CI and skip the deploy job.
function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}