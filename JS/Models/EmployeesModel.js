// All employee-related reads/writes: the directory view (for the grid),
// the underlying `employees` table (for create/update/delete + scan logs),
// and the lookups the Employee modal needs to offer available cards.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';
import { fetchAllRows } from '../Utils/fetchAllRows.js';

const base = createModel('employees');

// Every employee_directory column the client actually reads. Explicit rather than
// '*' because this view is refetched in full on every visit, so it also exposes
// `last_scan` (a whole jsonb entry per row), `total_remarks`, `created_at` and
// `updated_at` — none of which anything renders. Keep in sync with what
// DirectoryPage and EmployeeModal consume.
const DIRECTORY_COLUMNS = [
  'id', 'employee_code', 'full_name', 'department', 'position', 'email', 'phone',
  'photo_url', 'photo_file_id', 'status', 'active_proximity_code',
  'proximity_card_active', 'proximity_card_id', 'total_scans', 'open_remarks',
].join(',');

// invoke() surfaces only a generic "non-2xx status code" message; the function's
// real { error } body sits unread on error.context. Pull it out so a failure says
// something actionable.
async function readFunctionError(error) {
  if (!error) return null;
  try {
    if (error.context && typeof error.context.clone === 'function') {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    }
  } catch {
    // response body wasn't JSON (or already consumed) — fall through to the generic message
  }
  return error.message || 'Request failed';
}

export const EmployeesModel = {
  ...base,

  // Employee Manager grid. Pages past Supabase's 1000-row cap — see
  // Utils/fetchAllRows.js for why .limit() cannot.
  async listDirectory() {
    return fetchAllRows((from, to) =>
      supabase.from('employee_directory')
        .select(DIRECTORY_COLUMNS)
        .order('full_name')
        .range(from, to)
    );
  },

  // employee_id -> proximity_card_id lookups (used to filter out cards
  // that are already assigned to someone else).
  async listCardLinks() {
    return supabase.from('employees').select('proximity_card_id');
  },

  // Used by the Proximity Cards page to show who a card belongs to.
  async listForCardAssignment() {
    return supabase.from('employees').select('id, full_name, employee_code, status, proximity_card_id');
  },

  async createEmployee(payload) {
    return supabase.from('employees').insert(payload);
  },

  // One round-trip per chunk for CSV import. On error the caller retries that
  // chunk row-by-row to find which row failed.
  async createMany(payloads) {
    return supabase.from('employees').insert(payloads).select('id');
  },

  async updateEmployee(id, payload) {
    return supabase.from('employees').update(payload).eq('id', id);
  },

  async deleteEmployee(id) {
    return supabase.from('employees').delete().eq('id', id);
  },

  async deleteMany(ids) {
    return supabase.from('employees').delete().in('id', ids);
  },

  // An always-true filter rather than .in() over every id: PostgREST filters are
  // query params even for DELETE, so a few hundred ids blow past the gateway's
  // URL length limit and return a bare 400. One request, any table size.
  async deleteAll() {
    return supabase.from('employees').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  },

  async getScanLogs(employeeId) {
    return supabase.from('employees').select('full_name, scan_logs').eq('id', employeeId).single();
  },

  // Deletes the underlying scan_events row too, not just the cached jsonb entry,
  // so Recent Activity stays in sync. Admin-only, enforced in the RPC: an
  // audit-trail correction, not a routine edit.
  async deleteScanLog(employeeId, scanId) {
    return supabase.rpc('delete_employee_scan_log', { p_employee_id: employeeId, p_scan_id: scanId });
  },

  async getRemarks(employeeId) {
    return supabase.from('employees').select('full_name, remarks_log').eq('id', employeeId).single();
  },

  // An RPC rather than a plain update so two people remarking on the same
  // employee cannot clobber each other's entry.
  async addRemark(employeeId, remark) {
    return supabase.rpc('add_employee_remark', { p_employee_id: employeeId, p_remark: remark });
  },

  // Also an RPC, same concurrency reasoning as addRemark.
  async resolveRemark(employeeId, remarkId, resolved) {
    return supabase.rpc('resolve_employee_remark', { p_employee_id: employeeId, p_remark_id: remarkId, p_resolved: resolved });
  },

  // Uploads a converted photo to Drive via the upload-employee-photo function.
  //
  // Raw XHR rather than supabase.functions.invoke(): invoke() is fetch-based, and
  // fetch has no upload progress event — it resolves only once the whole
  // round-trip is done. Fine for small payloads, but a base64 photo takes long
  // enough that no feedback reads as broken. xhr.upload.onprogress gives real
  // byte-level progress.
  //
  // mimeType must be the ACTUAL blob.type, since canvas.toBlob can silently
  // produce something other than webp; the function only guesses when it is
  // omitted. thumbBase64/thumbMimeType skip the function's own lower-res
  // server-side thumbnail fetch, and null is fine — it falls back.
  //
  // onProgress(pct) reaching 100 means the bytes are sent, NOT that the upload is
  // done: the function is still talking to Drive, so callers should show an
  // indeterminate "finishing" state.
  uploadPhoto({ base64, mimeType, thumbBase64, thumbMimeType, filename, oldFileId, onProgress }) {
    return new Promise(async (resolve) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        resolve({ error: 'Your session has expired — please sign in again.' });
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/functions/v1/upload-employee-photo`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };

      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch {
          // non-JSON response (e.g. a gateway error page) — body stays null, handled below
        }
        if (xhr.status >= 200 && xhr.status < 300 && body && !body.error) {
          resolve({ data: body }); // { url, file_id, thumb_b64 }
        } else {
          resolve({ error: body?.error || `Upload failed (HTTP ${xhr.status})` });
        }
      };
      xhr.onerror = () => resolve({ error: 'Network error while uploading the photo. Check your connection and try again.' });
      xhr.onabort = () => resolve({ error: 'Upload cancelled.' });

      xhr.send(JSON.stringify({
        action: 'upload',
        image_base64: base64,
        mime_type: mimeType || null,
        thumb_base64: thumbBase64 || null,
        thumb_mime_type: thumbMimeType || null,
        filename,
        old_file_id: oldFileId || null,
      }));
    });
  },

  // For a photo removed without a replacement. Tiny payload with no progress
  // worth showing, so invoke() rather than the XHR plumbing above.
  async deletePhoto(fileId) {
    if (!fileId) return { data: true };
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session.access_token;
    const { data, error } = await supabase.functions.invoke('upload-employee-photo', {
      body: { action: 'delete', old_file_id: fileId },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { error: await readFunctionError(error) };
    return { data };
  },

  // Storage usage/limit (bytes) on the Google account employee photos are
  // uploaded into — that account's own quota is the real ceiling on how
  // many more photos can be stored, so it's what Settings' "Employee
  // photos" capacity panel reads. Same tiny invoke() pattern as
  // deletePhoto rather than uploadPhoto's XHR plumbing.
  async getPhotoStorageQuota() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session.access_token;
    const { data, error } = await supabase.functions.invoke('upload-employee-photo', {
      body: { action: 'quota' },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { error: await readFunctionError(error) };
    return { data }; // { usage, limit, usageInDrive }
  },

  // ---- offline-thumbnail recompression (Settings -> Employee photos) ----

  // Size distribution of photo_thumb_b64 in STORED (base64) bytes, measured
  // server-side so the panel can decide whether a pass is worth it without
  // downloading the column to find out.
  async offlineThumbStats(overTargetBytes) {
    return supabase.rpc('get_offline_thumb_stats', { p_over_target_bytes: overTargetBytes });
  },

  // One page of over-target thumbnails. Keyset-paged on id, not .range(),
  // because the caller UPDATEs rows as it walks and an offset would shift under
  // its own writes. Only over-target rows: PostgREST cannot express an
  // octet_length filter, and downloading already-small rows just to reject them
  // is pure egress.
  async thumbsToRecompress({ afterId = null, limit = 20, overTargetBytes } = {}) {
    return supabase.rpc('get_thumbs_to_recompress', {
      p_after_id: afterId,
      p_limit: limit,
      p_over_target_bytes: overTargetBytes,
    });
  },

  // A plain table UPDATE — employees_update_admin_manager already expresses
  // exactly this, so no RPC is needed.
  //
  // Side effect: trg_employees_updated_at fires, so every rewritten row shows up
  // in the next scanner lookup delta (which carries no photos, so the cost is one
  // small resync). Kiosks keep the thumbnails they hold, because the photo cache
  // keys on photo_file_id and this does not touch it.
  async updateThumb(id, thumbB64) {
    return supabase.from('employees').update({ photo_thumb_b64: thumbB64 }).eq('id', id);
  },

  // ---- missing kiosk thumbnails ----

  // One keyset page of employees with a Drive photo but no photo_thumb_b64 —
  // correct in Employee Manager, invisible on every kiosk. Returns id and name
  // only; no photo bytes are involved on this side at all.
  async employeesMissingThumb({ afterId = null, limit = 25 } = {}) {
    return supabase.rpc('get_employees_missing_thumb', { p_after_id: afterId, p_limit: limit });
  },

  // Repairs one of them. The Edge Function fetches from Drive and writes the row
  // itself, returning a status rather than the thumbnail: at ~11 KB each,
  // returning the bytes would turn a roster-wide repair into megabytes of egress
  // for data this browser never renders.
  //
  // Resolves to { data: { ok, bytes?, skipped?, reason? } }. `ok: false` with a
  // reason is a normal answer, not a failure — Drive has no usable thumbnail for
  // some files, and a caller repairing hundreds of rows must count it and
  // continue rather than abort.
  async backfillThumb(employeeId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { error: 'Your session has expired — please sign in again.' };
    const { data, error } = await supabase.functions.invoke('upload-employee-photo', {
      body: { action: 'backfill_thumb', employee_id: employeeId },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { error: await readFunctionError(error) };
    return { data };
  },
};