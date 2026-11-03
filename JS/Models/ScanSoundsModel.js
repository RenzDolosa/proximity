// The 6 admin-uploaded scan feedback sounds, stored in the public
// `scan-sounds` Storage bucket under fixed, extension-less object keys.
// Fixed keys mean "replace" is a plain upsert onto the same path — no
// old-file cleanup needed across format changes, unlike the Drive photo
// flow (see Supabase/README.md for why that one needs it).
import { supabase } from '../Core/supabaseClient.js';
import { uploadToStorage } from '../Utils/xhrUpload.js';

const BUCKET = 'scan-sounds';

// UI-facing key -> Storage object path. The UI/Scanner code only ever
// deals in the left-hand keys; this mapping is the one place that knows
// the actual bucket layout.
// The bucket's own file_size_limit (see Supabase/README.md — set when the
// bucket was created, not discoverable via the storage client at runtime).
// Kept here as the one place that knows it, so the Settings page can show
// "X of Y used" without hard-coding the number a second time.
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// The catalogue itself lives in Utils/scanSoundKeys.js — pure, so the Node
// tests can import it without this file dragging in the Supabase client (and
// with it `window`). Re-exported here because every existing caller imports
// these two from the model.
export { SOUND_KEYS, SOUND_LABELS } from '../Utils/scanSoundKeys.js';

export const ScanSoundsModel = {
  // Lists whatever's currently in the bucket (name + updated_at per
  // object) — used both by the Settings page (to show "set"/"not set" +
  // upload date) and by Utils/scanSounds.js (to build cache-busted
  // playback URLs). One list() covers all 4 keys in a single request.
  async list() {
    return supabase.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  },

  // Public URL for a given sound key. The bucket is public, so this URL
  // works for playback with no auth — callers should still append a
  // cache-busting query param (see Utils/scanSounds.js) since the same
  // path gets reused on every replace.
  publicUrl(key) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(SOUND_KEYS[key]);
    return data.publicUrl;
  },

  // Admin-only (enforced by storage RLS, not just hidden in the UI).
  // upsert:true means picking a new file for a key that already has one
  // just overwrites it in place — same path, no orphaned old file.
  //
  // Goes through XMLHttpRequest rather than storage-js when a progress
  // callback is given: fetch(), which storage-js uses, reports no upload
  // progress at all. Same endpoint, same headers, same single request — see
  // Utils/xhrUpload.js. Without a callback it stays on storage-js, so nothing
  // that does not need a bar changes path.
  async upload(key, file, onProgress) {
    if (!onProgress) {
      return supabase.storage.from(BUCKET).upload(SOUND_KEYS[key], file, {
        upsert: true,
        contentType: file.type || 'audio/mpeg',
        cacheControl: '3600',
      });
    }
    return uploadToStorage(BUCKET, SOUND_KEYS[key], file, { onProgress });
  },

  async remove(key) {
    return supabase.storage.from(BUCKET).remove([SOUND_KEYS[key]]);
  },
};
