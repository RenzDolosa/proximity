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
// Separate from `urlsByKey` being non-null: a *successful* list() can
// legitimately resolve to no sounds configured yet, which still counts as
// "loaded" (nothing to retry). This flag exists only to answer "did the
// last attempt fail" so callers know whether a retry is worthwhile.
let loaded = false;

// Exposed so a caller (e.g. the standalone scanner's reconnect/periodic
// handler) can tell whether the initial load ever actually succeeded and
// retry loadScanSounds() if not — see the `loaded` comment above. Without
// this, a kiosk that boots while offline (or whose very first list() call
// races a flaky connection) stays silent for its *entire* session: the
// original code only ever called loadScanSounds() once, on mount, and
// swallowed a failure with no way to know it needed a retry.
export function scanSoundsLoaded() {
  return loaded;
}

// Browsers require a user gesture before allowing audio playback, and —
// this is the part that actually bit us — that allowance has to be
// claimed synchronously inside the gesture's own event handler. Every
// call to playScanSound() happens from inside doScan(), AFTER an `await`
// on either the scan RPC or the offline-cache lookup. By the time
// execution resumes and reaches `.play()`, the transient activation from
// the keydown/Enter that started the whole thing has already expired —
// so the play() promise rejects on the autoplay policy and gets silently
// swallowed below, every single time, not just intermittently. That's why
// "no scan sounds" was a hard 100%-of-the-time bug, not a flaky one.
//
// Fix: play a near-silent clip SYNCHRONOUSLY inside the very first real
// keydown/pointerdown this page sees — no `await` in between gesture and
// play(). Once a page has successfully played audio off a direct gesture
// like that, browsers (Chrome's Media Engagement Index in particular)
// allow further programmatic audio.play() calls on that page for the
// rest of the session regardless of subsequent async gaps. Call this once
// per screen mount, same place as loadScanSounds() — StandaloneScanner.js
// and TestScanPage.js both do.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let audioUnlocked = false;

export function initAudioUnlock() {
  if (audioUnlocked) return;
  const unlock = () => {
    new Audio(SILENT_WAV).play().then(() => {
      audioUnlocked = true;
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('pointerdown', unlock);
    }).catch(() => {
      // Still locked — this "gesture" apparently didn't count (some
      // browsers are picky about synthetic/trusted events). Listeners
      // stay attached so the next real one tries again.
    });
  };
  document.addEventListener('keydown', unlock);
  document.addEventListener('pointerdown', unlock);
}

export async function loadScanSounds() {
  const { data, error } = await ScanSoundsModel.list();
  if (error) return; // leave `loaded` false — caller can retry later
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
  loaded = true;
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