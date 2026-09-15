// Shared by StandaloneScanner.js and TestScanPage.js: loads whichever of
// the 4 admin-uploaded scan sounds currently exist, then plays the right
// one for a given scan_proximity_code()/test_scan_proximity_code() result.
//
// loadScanSounds() is meant to be called once per screen mount (a kiosk
// tab or a Test Scan page visit), not per-scan — re-listing the bucket on
// every single scan would add a network round-trip to the hot path for no
// benefit, since sounds only change when an admin visits Settings.
import { ScanSoundsModel, SOUND_KEYS } from '../Models/ScanSoundsModel.js';

let urlsByKey = null; // { matched_in: url|null, ... } once loaded, else null

export async function loadScanSounds() {
  const { data } = await ScanSoundsModel.list();
  const byPath = Object.fromEntries((data || []).map((o) => [o.name, o]));
  const next = {};
  for (const key of Object.keys(SOUND_KEYS)) {
    const obj = byPath[SOUND_KEYS[key]];
    // Cache-bust with the object's own updated_at — same reasoning as
    // avatarHTML()'s `cb` param for employee photos: the path never
    // changes on replace (upsert), so without this the browser can keep
    // playing a stale cached clip after an admin swaps it out.
    next[key] = obj ? `${ScanSoundsModel.publicUrl(key)}?v=${encodeURIComponent(obj.updated_at || obj.id || '')}` : null;
  }
  urlsByKey = next;
}

function keyForResult(data) {
  if (data?.result === 'matched') return data.direction === 'out' ? 'matched_out' : 'matched_in';
  if (data?.result === 'inactive_card') return 'card_revoked';
  if (data?.result === 'unmatched') return 'unmatched';
  if (data?.result === 'unassigned_card') return 'unassigned_card';
  // inactive_employee: no dedicated sound was requested for this one —
  // it stays silent rather than falling back to an unrelated clip that
  // would misrepresent the actual result.
  return null;
}

// Safe to call even if loadScanSounds() hasn't resolved yet or failed —
// a missing/not-yet-loaded sound just means silence, never a thrown error
// that could interrupt the scan flow itself.
export function playScanSound(data) {
  const key = keyForResult(data);
  const url = key && urlsByKey?.[key];
  if (!url) return;
  const audio = new Audio(url);
  audio.play().catch(() => {
    // Most likely the browser's autoplay policy (no user gesture yet on
    // this page) or a decode error on whatever the admin uploaded —
    // either way, a missed notification sound shouldn't block or error
    // out the actual scan result on screen.
  });
}