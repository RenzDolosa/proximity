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
{ "action": "upload", "image_base64": "<webp bytes, base64>", "filename": "EMP-1044", "old_file_id": "1AbC..." }
// delete:
{ "action": "delete", "old_file_id": "1AbC..." }
```

Called from `JS/Models/EmployeesModel.js#uploadPhoto` /
`#deletePhoto`. `EmployeeModal.js` converts whatever image the user picks
to `.webp` client-side (`JS/Utils/image.js`) before it ever reaches this
function — the function itself just stores whatever bytes it's given.

**Response**
- upload: `{ "url": "https://drive.google.com/uc?export=view&id=...", "file_id": "..." }`
- delete: `{ "ok": true }`
- error: `{ "error": "message" }`

Access is gated by `is_admin_or_manager()`, re-checked server-side against
the caller's own JWT — a signed-in viewer gets a 403 even with a valid
session.

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

**Refresh token stops working?** The most common cause is the consent
screen having been left in "Testing" (step 2) — reissue a token from
Playground after switching to "In production". A revoked token (e.g. you
removed the app's access under
[myaccount.google.com/permissions](https://myaccount.google.com/permissions))
shows up as an `invalid_grant` error and needs the same re-issue.

**Sharing model:** uploaded photos are set to "anyone with the link can
view" so `photo_url` renders directly as an `<img src>` in the app. If
that's broader than you want (e.g. photos should only be visible to
signed-in staff), the fix is to stop calling `makeFilePublic()` in
`index.ts` and instead have the app fetch a short-lived signed link
per-view — a larger change, not done here.
