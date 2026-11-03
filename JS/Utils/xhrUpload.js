// Upload a file to Supabase Storage with REAL byte progress.
//
// supabase-js's storage.upload() goes through fetch(), and fetch exposes no
// upload progress at all — which is why the scan-sound bar was an
// indeterminate shimmer pinned at 100% while the bytes were still going. On
// a slow link that is a bar that looks finished for thirty seconds.
//
// XMLHttpRequest still has upload.onprogress, so this talks to the same
// Storage REST endpoint supabase-js would have called, with the same headers,
// and reports loaded/total as it goes. Same single request, same bytes — only
// the reporting differs, so nothing here changes egress or log ingestion.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../Core/supabaseClient.js';
import { progressPercent } from './progress.js';

/**
 * @returns {Promise<{ data?: object, error?: { message: string } }>}
 *   Shaped like supabase-js so callers do not have to branch.
 */
export async function uploadToStorage(bucket, path, file, { onProgress, upsert = true, cacheControl = '3600' } = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { error: { message: 'Not signed in.' } };

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, true);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    // Same contract as storage-js's upsert option: without it a second upload
    // to an existing key is a 409 rather than a replace, and every one of
    // these paths is written repeatedly by design.
    xhr.setRequestHeader('x-upsert', String(upsert));
    xhr.setRequestHeader('cache-control', `max-age=${cacheControl}`);
    if (file.type) xhr.setRequestHeader('content-type', file.type);

    xhr.upload.addEventListener('progress', (e) => {
      // lengthComputable is false for a chunked body; reporting null lets the
      // caller fall back to the indeterminate style rather than draw a lie.
      onProgress?.(e.lengthComputable ? progressPercent(e.loaded, e.total) : null);
    });
    // The bytes being sent is not the same as the server having accepted
    // them. Hand back null at the hand-over so the bar stops claiming
    // measured progress while the server is still thinking.
    xhr.upload.addEventListener('load', () => onProgress?.(null));

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* a 200 with no body is still a success */ }
        resolve({ data });
        return;
      }
      let message = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText || '{}');
        if (body.message || body.error) message = body.message || body.error;
      } catch { /* keep the status-code message */ }
      resolve({ error: { message, status: xhr.status } });
    });
    xhr.addEventListener('error', () => resolve({ error: { message: 'Network error during upload.' } }));
    xhr.addEventListener('abort', () => resolve({ error: { message: 'Upload cancelled.' } }));

    xhr.send(file);
  });
}
