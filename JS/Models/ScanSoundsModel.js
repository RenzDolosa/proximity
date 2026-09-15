// The 4 admin-uploaded scan feedback sounds, stored in the public
// `scan-sounds` Storage bucket under fixed, extension-less object keys.
// Fixed keys mean "replace" is a plain upsert onto the same path — no
// old-file cleanup needed across format changes, unlike the Drive photo
// flow (see Supabase/README.md for why that one needs it).
import { supabase } from '../Core/supabaseClient.js';

const BUCKET = 'scan-sounds';

// UI-facing key -> Storage object path. The UI/Scanner code only ever
// deals in the left-hand keys; this mapping is the one place that knows
// the actual bucket layout.
// The bucket's own file_size_limit (see Supabase/README.md — set when the
// bucket was created, not discoverable via the storage client at runtime).
// Kept here as the one place that knows it, so the Settings page can show
// "X of Y used" without hard-coding the number a second time.
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const SOUND_KEYS = {
  matched_in: 'matched-in',
  matched_out: 'matched-out',
  card_revoked: 'card-revoked',
  unmatched: 'unmatched',
  unassigned_card: 'unassigned-card',
};

export const SOUND_LABELS = {
  matched_in: 'Matched / Success — IN scan',
  matched_out: 'Matched / Success — OUT scan',
  card_revoked: 'Card revoked scan',
  unmatched: 'Unknown proximity ID scan',
  unassigned_card: 'Unassigned card scan',
};

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
  async upload(key, file) {
    return supabase.storage.from(BUCKET).upload(SOUND_KEYS[key], file, {
      upsert: true,
      contentType: file.type || 'audio/mpeg',
      cacheControl: '3600',
    });
  },

  async remove(key) {
    return supabase.storage.from(BUCKET).remove([SOUND_KEYS[key]]);
  },
};
