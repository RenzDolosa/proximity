// upload-employee-photo Edge Function
//
// POST { action: "upload", image_base64: string, filename: string, old_file_id?: string|null }
//   -> { url: string, file_id: string }
// POST { action: "delete", old_file_id: string }
//   -> { ok: true }
//
// Auth: caller must be a signed-in admin or manager. The platform verifies
// the JWT itself (verify_jwt: true); this function additionally re-checks
// role server-side via is_admin_or_manager() using a client scoped to the
// CALLER's own JWT — same pattern as proximity-scan — so a viewer with a
// valid session still can't upload/delete photos even though they're
// authenticated.
//
// Storage: Google Drive, via a Google Cloud service account (not Supabase
// Storage) — the image never touches the service-role key or a public
// bucket. The service account authenticates itself with a signed JWT
// (RS256, Web Crypto — Deno's edge runtime has no Node `crypto` module) and
// exchanges it for a short-lived OAuth access token, then talks to the
// Drive v3 API directly.
//
// Required Edge Function secrets (set via `supabase secrets set` or the
// Dashboard, NOT committed to the repo):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   the service account's client_email
//   GOOGLE_PRIVATE_KEY             its private_key, PEM format (\n's ok as
//                                  literal escaped newlines — see below)
//   GOOGLE_DRIVE_FOLDER_ID         the Drive folder to upload into; that
//                                  folder must be shared with the service
//                                  account email as an Editor
//
// See Supabase/functions/upload-employee-photo/README.md for the full
// one-time Google Cloud setup.

import { createClient } from "jsr:@supabase/supabase-js@2";

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

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

    const clientEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
    if (!clientEmail || !privateKey || !folderId) {
      return json({ error: "Google Drive isn't configured yet — GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_DRIVE_FOLDER_ID must be set as Edge Function secrets." }, 500, cors);
    }
    const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

    if (action === "delete") {
      if (body.old_file_id) await deleteDriveFile(body.old_file_id, accessToken); // best-effort
      return json({ ok: true }, 200, cors);
    }

    if (action === "upload") {
      const { image_base64, filename, old_file_id } = body;
      if (!image_base64 || typeof image_base64 !== "string") {
        return json({ error: "image_base64 is required" }, 400, cors);
      }
      const bytes = base64ToBytes(image_base64);
      if (bytes.length > 8 * 1024 * 1024) {
        return json({ error: "Photo is too large (max 8MB)." }, 400, cors);
      }

      const safeName = (filename || "employee-photo").replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileId = await uploadToDrive(bytes, `${safeName}.webp`, folderId, accessToken);
      await makeFilePublic(fileId, accessToken); // "anyone with the link can view"

      if (old_file_id && old_file_id !== fileId) {
        await deleteDriveFile(old_file_id, accessToken); // best-effort, replacing an old photo
      }

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

// ---- Google service-account auth (JWT Bearer flow) ----

async function getGoogleAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64urlFromBytes(new Uint8Array(signature))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Google authentication failed — check the service account secrets.");
  return data.access_token;
}

// Accepts the private key either as a raw PEM block (with real newlines)
// or with literal "\n" escapes, which is how it typically ends up after
// being pasted into a Dashboard/CLI secret value.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = base64ToBytes(b64);
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// ---- Drive API ----

async function uploadToDrive(bytes: Uint8Array, name: string, folderId: string, accessToken: string): Promise<string> {
  const boundary = "proximity-photo-" + crypto.randomUUID();
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Type: image/webp\r\n\r\n`),
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
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}/permissions?supportsAllDrives=true`, {
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
    await fetch(`${DRIVE_FILES_URL}/${fileId}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // best-effort — an orphaned Drive file is a non-issue, never fail the
    // caller's request over cleanup of the OLD photo.
  }
}

// ---- base64 helpers (Deno has no Buffer) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64url(str: string): string {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
