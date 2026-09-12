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

## One-time Google Cloud setup

The function authenticates to Google Drive as a **service account** (no
per-user Google login, no OAuth consent screen — appropriate for a
kiosk/admin-console app where a human isn't sitting at a browser
approving scopes).

1. In [Google Cloud Console](https://console.cloud.google.com), create or
   pick a project, then enable the **Google Drive API**
   (APIs & Services → Library → "Google Drive API" → Enable).
2. APIs & Services → Credentials → **Create credentials → Service account**.
   Give it any name (e.g. `proximity-photo-uploader`). No project role is
   needed — access is granted at the folder level in step 4.
3. Open the new service account → **Keys → Add key → Create new key → JSON**.
   This downloads a `.json` file — treat it like a password, it's never
   committed to this repo.
4. In Google Drive, create (or pick) a folder for employee photos, then
   **Share** it with the service account's email address (the `client_email`
   field in the JSON file, looks like
   `proximity-photo-uploader@your-project.iam.gserviceaccount.com`) as
   **Editor**. Copy the folder's id from its URL:
   `https://drive.google.com/drive/folders/<THIS_PART>`.
5. Set three Edge Function secrets (from the terminal, with the Supabase
   CLI linked to this project — or via Dashboard → Edge Functions →
   Secrets):
   ```
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="proximity-photo-uploader@your-project.iam.gserviceaccount.com"
   supabase secrets set GOOGLE_DRIVE_FOLDER_ID="<folder id from step 4>"
   supabase secrets set GOOGLE_PRIVATE_KEY="$(node -e "console.log(require('./service-account.json').private_key)")"
   ```
   The last one matters: `GOOGLE_PRIVATE_KEY` must be the exact
   `private_key` string from the JSON file (including the
   `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines). The
   function accepts either real newlines or literal `\n` escapes in that
   value, since different shells/dashboards mangle them differently.
6. Delete the downloaded `.json` key file once the secrets are set — it's
   no longer needed locally.

Until all three secrets are set, the function returns a clear
"Google Drive isn't configured yet" error instead of a photo URL — the
rest of the Employee Manager (including the photo picker and .webp
conversion) works either way, it just can't finish the upload.

**Sharing model:** uploaded photos are set to "anyone with the link can
view" so `photo_url` renders directly as an `<img src>` in the app. If
that's broader than you want (e.g. photos should only be visible to
signed-in staff), the fix is to stop calling `makeFilePublic()` in
`index.ts` and instead have the app fetch a short-lived signed link
per-view — a larger change, not done here.
