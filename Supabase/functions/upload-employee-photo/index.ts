// upload-employee-photo Edge Function
//
// POST { action: "upload", image_base64: string, filename: string, mime_type?: string, old_file_id?: string|null }
//   -> { url: string, file_id: string }
// POST { action: "delete", old_file_id: string }
//   -> { ok: true }
//
// mime_type should be the ACTUAL type of the bytes in image_base64 (e.g.
// what Blob.type reported after client-side conversion) — canvas.toBlob()
// can silently fall back to a different format than requested, so the
// client can't assume it always produced .webp, and neither can this
// function. Falls back to image/webp only if the caller omits mime_type.
//
// Auth: caller must be a signed-in admin or manager. The platform verifies
// the JWT itself (verify_jwt: true); this function additionally re-checks
// role server-side via is_admin_or_manager() using a client scoped to the
// CALLER's own JWT — same pattern as proximity-scan — so a viewer with a
// valid session still can't upload/delete photos even though they're
// authenticated.
//
// Storage: Google Drive, authenticated as a real Google account via OAuth
// (NOT a service account). Google service accounts have zero storage quota
// of their own — they can only write into Shared Drives or act via
// domain-wide delegation, both of which require a paid Google Workspace
// account. For a personal Gmail account, the only way for server-side code
// to write into "My Drive" is to act as that real account, so this function
// holds a long-lived OAuth refresh token for that account and exchanges it
// for a short-lived access token on each call.
//
// Required Edge Function secrets (set via `supabase secrets set` or the
// Dashboard, NOT committed to the repo):
//   GOOGLE_OAUTH_CLIENT_ID       OAuth 2.0 Client ID (Web application type)
//   GOOGLE_OAUTH_CLIENT_SECRET   its client secret
//   GOOGLE_OAUTH_REFRESH_TOKEN   a refresh token obtained once for the
//                                Google account that owns the target folder
//   GOOGLE_DRIVE_FOLDER_ID       the Drive folder to upload into (must be
//                                owned by, or shared as Editor with, that
//                                same account)
//
// See Supabase/functions/upload-employee-photo/README.md for the full
// one-time Google Cloud + OAuth Playground setup to get the refresh token.

import { createClient } from "jsr:@supabase/supabase-js@2";

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
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

    // Scoped to the caller's own JWT — RLS + is_admin_or_manager() evaluate
    // against THIS user, never a service role.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: allowed, error: roleErr } = await supabase.rpc("is_admin_or_manager");
    if (roleErr) return json({ error: roleErr.message }, 400, cors);
    if (!allowed) return json({ error: "Only admins and managers can manage employee photos." }, 403, cors);

    const body = await req.json();
    const action = body.action;

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
    if (!clientId || !clientSecret || !refreshToken || !folderId) {
      return json({ error: "Google Drive isn't configured yet — GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, and GOOGLE_DRIVE_FOLDER_ID must be set as Edge Function secrets." }, 500, cors);
    }
    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);

    if (action === "delete") {
      if (body.old_file_id) await deleteDriveFile(body.old_file_id, accessToken); // best-effort
      return json({ ok: true }, 200, cors);
    }

    if (action === "upload") {
      const { image_base64, filename, mime_type, old_file_id } = body;
      if (!image_base64 || typeof image_base64 !== "string") {
        return json({ error: "image_base64 is required" }, 400, cors);
      }
      const bytes = base64ToBytes(image_base64);
      if (bytes.length > 8 * 1024 * 1024) {
        return json({ error: "Photo is too large (max 8MB)." }, 400, cors);
      }

      // Trust whatever mime type the client actually produced (canvas.toBlob
      // can silently fall back to a different format than requested — see
      // Utils/image.js) rather than assuming .webp. Falls back to webp only
      // if an older client doesn't send mime_type at all.
      const contentType = typeof mime_type === "string" && EXTENSION_BY_MIME[mime_type] ? mime_type : "image/webp";
      const ext = EXTENSION_BY_MIME[contentType];

      const safeName = (filename || "employee-photo").replace(/[^a-zA-Z0-9._-]/g, "_");

      // Deleting the OLD photo (when replacing one) doesn't depend on the
      // NEW upload finishing — both only need accessToken. Running it
      // concurrently instead of after the upload+make-public sequence saves
      // a full Google API round trip off the critical path. It's already
      // best-effort (errors swallowed), so it doesn't need to block the
      // response at all: kick it off, let it finish in the background via
      // EdgeRuntime.waitUntil (falls back to a bounded await if that global
      // isn't available in this runtime).
      let deleteOldPromise: Promise<void> = Promise.resolve();
      if (old_file_id) {
        deleteOldPromise = deleteDriveFile(old_file_id, accessToken);
        const bg = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (bg?.waitUntil) {
          bg.waitUntil(deleteOldPromise);
          deleteOldPromise = Promise.resolve(); // already handed off — don't also await it below
        }
      }

      const fileId = await uploadToDrive(bytes, `${safeName}.${ext}`, contentType, folderId, accessToken);
      await makeFilePublic(fileId, accessToken); // "anyone with the link can view"
      await deleteOldPromise; // no-op if EdgeRuntime.waitUntil already took it, otherwise waits for the best-effort delete

      // Directly embeddable (not just "open in Drive") image URL.
      const url = `https://drive.google.com/uc?export=view&id=${fileId}`;
      return json({ url, file_id: fileId }, 200, cors);
    }

    return json({ error: `Unknown action "${action}"` }, 400, cors);
  } catch (err) {
    return json({ error: (err as Error).message }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---- Google OAuth (refresh token -> short-lived access token) ----
// Much simpler than the service-account JWT-signing flow it replaces: no
// RS256/Web Crypto involved, just a single token-refresh POST.

async function getGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
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
  const data = await res.json();
  if (!res.ok) {
    // A revoked/expired refresh token (e.g. the OAuth consent screen was
    // left in "Testing" mode, which caps tokens at 7 days — see README)
    // shows up here as invalid_grant.
    throw new Error(data.error_description || data.error || "Google authentication failed — the refresh token may be invalid or revoked.");
  }
  return data.access_token;
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

async function deleteDriveFile(fileId: string, accessToken: string) {
  try {
    await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // best-effort — an orphaned Drive file is a non-issue, never fail the
    // caller's request over cleanup of the OLD photo.
  }
}

// ---- base64 helper (Deno has no Buffer) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
