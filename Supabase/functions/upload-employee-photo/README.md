# upload-employee-photo

Source lives in this repo (`index.ts`, next to this file) — deploy with
`supabase functions deploy upload-employee-photo` (or it was pushed
directly from the assistant session that built it).

**Request**
```
POST https://kjwttqmbcjvkivgmwuev.supabase.co/functions/v1/upload-employee-photo
Authorization: Bearer <user's access_token>
Content-Type: application/json

// upload:
{ "action": "upload", "image_base64": "<image bytes, base64>", "mime_type": "image/webp",
  "filename": "EMP-1044", "old_file_id": "1AbC...",
  "thumb_base64": "<~480px .webp thumbnail, base64>", "thumb_mime_type": "image/webp" }
// delete:
{ "action": "delete", "old_file_id": "1AbC..." }
// quota (read-only, Settings' "Employee photos" panel):
{ "action": "quota" }
```

Called from `JS/Models/EmployeesModel.js#uploadPhoto` / `#deletePhoto` /
`#getPhotoStorageQuota`. `EmployeeModal.js` converts whatever image the user
picks to `.webp` client-side (`JS/Utils/image.js`) before it ever reaches this
function — the function itself just stores whatever bytes it's given.
`thumb_base64` is optional: when it's missing or malformed the function falls
back to a (lower-res, 2.5s-bounded) server-side Drive thumbnail fetch.

**Response**
- upload: `{ "url": "https://drive.google.com/thumbnail?id=...&sz=w512", "file_id": "...", "thumb_b64": "..."|null }`
- delete: `{ "ok": true }`
- quota: `{ "usage": n, "limit": n|null, "usageInDrive": n }` (bytes; `limit` null = uncapped account)
- error: `{ "error": "message" }`, plus a stable `"code"` when the cause is the
  stored Google credentials rather than the request:

| HTTP | `code` | Meaning | Fix |
|---|---|---|---|
| 503 | `google_reauth_required` | Google answered `invalid_grant` — the stored **refresh token** is expired/revoked | Re-issue the token (see "Refresh token stops working?" below) |
| 503 | `google_client_invalid` | Google answered `invalid_client` / `unauthorized_client` — OAuth client deleted, secret rotated or mistyped | Check `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` |
| 4xx/500 | — | Anything else (bad request, permission, Drive API error) | — |

Access is gated per action, re-checked server-side against the caller's own
JWT: `upload` / `delete` need `is_admin_or_manager()`; `quota` needs
`can_view_settings()`. A signed-in viewer without Settings access gets a 403
even with a valid session.

## Why OAuth instead of a service account

The first version of this function used a Google **service account**. That
doesn't work for a personal Gmail account: service accounts have **zero
Drive storage quota of their own**, so they can't own files — they can only
write into a **Shared Drive**, which is a paid **Google Workspace** feature,
not available on a plain `@gmail.com` account. (This is the
`Service Accounts do not have storage quota` error.)

The fix used here: the function authenticates as your **real Google
account** via OAuth, so uploads use your own Drive's quota — exactly as if
you'd uploaded the file yourself. This needs a one-time setup to get a
**refresh token**, done once by a human in a browser; after that the
function refreshes its own access token automatically on every call.

## One-time setup

### 1. Enable the Drive API
Google Cloud Console → pick or create a project → APIs & Services → Library
→ "Google Drive API" → Enable. (Skip if you already did this for the
earlier service-account attempt — same project is fine.)

### 2. Configure the OAuth consent screen
APIs & Services → OAuth consent screen:
- User type: **External**
- Fill in the required app name / support email fields (anything
  reasonable — this screen is only ever shown to you)
- Scopes: add `.../auth/drive` (or `.../auth/drive.file` if you'd rather
  grant narrower access — see note below)
- **Publishing status: set it to "In production"**, not "Testing". This
  matters: refresh tokens issued while the consent screen is in "Testing"
  mode **expire after 7 days**, silently breaking photo uploads a week
  later. "In production" without going through Google's verification is
  fine for this use case — you'll see an "unverified app" warning during
  consent (step 5), which is expected; click through it since it's your
  own app and account.

### 3. Create an OAuth Client ID
APIs & Services → Credentials → Create credentials → OAuth client ID:
- Application type: **Web application**
- Authorized redirect URI: `https://developers.google.com/oauthplayground`

Save the **Client ID** and **Client secret** shown.

### 4. Get a refresh token via OAuth Playground
1. Open [Google OAuth Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon (top right) → check **"Use your own OAuth
   credentials"** → paste the Client ID and Client secret from step 3.
3. In the left panel, find **Drive API v3** and select the
   `https://www.googleapis.com/auth/drive` scope (or `drive.file` — see
   note below).
4. Click **Authorize APIs**, sign in with **the Gmail account that owns
   your target Drive folder**, and click through the "Google hasn't
   verified this app" warning (Advanced → Go to \[app name\] (unsafe)).
5. Back in the Playground, click **Exchange authorization code for
   tokens**. Copy the **Refresh token** value shown.

### 5. Point the function at your target folder
In Google Drive, create (or pick) a folder for employee photos, owned by
that same account. Copy its id from the URL:
`https://drive.google.com/drive/folders/<THIS_PART>`.

### 6. Set the Edge Function secrets
```
supabase secrets set GOOGLE_OAUTH_CLIENT_ID="<client id from step 3>"
supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET="<client secret from step 3>"
supabase secrets set GOOGLE_OAUTH_REFRESH_TOKEN="<refresh token from step 4>"
supabase secrets set GOOGLE_DRIVE_FOLDER_ID="<folder id from step 5>"
```
If you'd previously set `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`
from the old approach, you can remove them — they're unused now:
```
supabase secrets unset GOOGLE_SERVICE_ACCOUNT_EMAIL GOOGLE_PRIVATE_KEY
```

Until all four current secrets are set, the function returns a clear
"Google Drive isn't configured yet" error instead of a photo URL — the
rest of the Employee Manager (including the photo picker and .webp
conversion) works either way, it just can't finish the upload.

**`drive` vs `drive.file` scope:** `drive` grants access to your entire
Drive, which is broader than strictly necessary but simplest — it can
write into a pre-existing folder you created outside the app (as in step
5). `drive.file` is narrower (only files/folders the app itself created or
that you explicitly picked via Google's file picker), but adopting it here
would mean either creating the target folder through this same OAuth flow
rather than by hand, or adding a Picker step — more setup for not much
practical benefit in a single-purpose internal tool.

### Refresh token stops working?

**What renews itself, and what can't.** The function already renews the
short-lived *access token* silently — a refresh-token → access-token exchange
on every cold call, cached in memory for ~1h. That is not what expires. What
dies is the long-lived *refresh token* itself, and **no code can mint a
replacement silently**: Google only issues a refresh token after an
interactive consent by a human in a browser. So the goal isn't "auto-renew the
refresh token" (impossible by design) — it's *stop it from dying*, and *find
out fast when it does*.

Symptom: uploads fail with "Google Drive access has expired or was revoked"
(HTTP 503, `code: "google_reauth_required"`), Settings → Employee photos shows
the same message, and the function log line reads
`Google token refresh failed (HTTP 400): invalid_grant — Token has been expired or revoked.`
Confirm in Supabase → Edge Functions → `upload-employee-photo` → Logs.

**Why refresh tokens die** (most to least likely for this setup):

| Cause | Prevention |
|---|---|
| OAuth consent screen left on **"Testing"** — refresh tokens expire after **7 days** | Set Publishing status to **"In production"** (step 2). Then re-issue the token — one issued *before* the switch keeps its 7-day limit. |
| Token **unused for 6 months** | Any real use resets the clock; a rarely-used install should hit Settings → Employee photos occasionally (it calls `quota`). |
| **Access revoked** at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), or the Google account was deleted/suspended | Don't remove the app there. |
| **More than 100 refresh tokens** issued for one account + one OAuth client — Google silently invalidates the *oldest* | Each Playground run mints a new one. Re-issue sparingly, and don't share this client ID with other apps. |
| OAuth client **deleted**, or its secret rotated | Shows as `google_client_invalid`; update the secrets. |
| Google Workspace policy (session length / API access controls) | Workspace admins only — not applicable to plain `@gmail.com`. |

**Re-issue (about 2 minutes):** repeat step 4 (Playground, own credentials,
Drive scope, sign in as the folder-owning account), then:
```
supabase secrets set GOOGLE_OAUTH_REFRESH_TOKEN="<new refresh token>"
```
No redeploy needed — secrets are read per invocation and the in-memory access
token cache is keyed to the refresh token, so it misses and re-fetches.

**Ways to remove this failure mode entirely** (in increasing effort):
1. *"In production"* consent screen (above) — fixes the 7-day case, the usual culprit.
2. Use a **Google Workspace** account with the OAuth app set to **Internal**
   — internal apps aren't subject to the Testing-mode expiry or the unverified
   app screen — or a service account + Shared Drive. Both need paid Workspace.
3. **Move employee photos to a Supabase Storage bucket.** No Google
   credential to expire at all; access control is plain RLS (the repo already
   does this for `scan-sounds`), and the Drive-thumbnail hot-linking this
   design relies on — which Google doesn't guarantee — goes away. Costs a
   one-off migration of existing `photo_url`/`photo_file_id` values and
   retiring this function.

**Sharing model:** uploaded photos are set to "anyone with the link can
view" so `photo_url` renders directly as an `<img src>` in the app. If
that's broader than you want (e.g. photos should only be visible to
signed-in staff), the fix is to stop calling `makeFilePublic()` in
`index.ts` and instead have the app fetch a short-lived signed link
per-view — a larger change, not done here.
