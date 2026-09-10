# admin-users

Deployed Edge Function — source lives in the Supabase project, not this
repo (pull it with `supabase functions download admin-users`, see
`../README.md`).

Handles the three account-management actions that need the service-role
key (`auth.admin.*`), which must never ship to the browser. Re-checks the
caller is really an admin (via their own JWT) before touching anything.
Called exclusively through `JS/Models/ProfilesModel.js#callAdminUsers`,
which wraps `supabase.functions.invoke('admin-users', ...)`.

**Actions** (`action` field in the request body)

| action | payload | used by |
|---|---|---|
| `create` | `full_name, email, password, role, access_scope` | `JS/Components/UserModal.js` (add user) |
| `update` | `user_id, full_name, email, role, access_scope` | `JS/Components/UserModal.js` (edit user) |
| `reset_password` | `user_id, password` | `JS/Components/ResetPasswordModal.js` |

**Response** — `{ data }` on success, or `{ error: string }`, which
`callAdminUsers` normalizes to `{ error }` either way so callers only need
one branch.
