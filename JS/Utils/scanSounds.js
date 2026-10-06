// Shared by StandaloneScanner.js and TestScanPage.js: loads the admin-uploaded
// scan sounds and plays the right one per scan result.
//
// loadScanSounds() is called once per screen mount, not per scan — sounds only
// change when an admin visits Settings, so re-listing the bucket on every scan
// would add a round trip to the hot path for nothing.
import { ScanSoundsModel, SOUND_KEYS } from '../Models/ScanSoundsModel.js';

// Bundled static tones, so the scanner always has something to play even on a
// device that has never been online — an admin-uploaded sound only becomes
// available offline after one successful fetch. sw.js precaches these paths at
// install time. Keep in sync with sw.js's PRECACHE_URLS and Public/Assets/Sounds/.
const FALLBACK_SOUND_PATHS = {
  matched_in: '/Public/Assets/Sounds/matched-in.wav',
  matched_out: '/Public/Assets/Sounds/matched-out.wav',
  card_revoked: '/Public/Assets/Sounds/card-revoked.wav',
  unmatched: '/Public/Assets/Sounds/unmatched.wav',
  unassigned_card: '/Public/Assets/Sounds/unassigned-card.wav',
};

let urlsByKey = null;
// Distinct from urlsByKey being set: a SUCCESSFUL list() can legitimately find no
// sounds configured, which still counts as loaded. This only answers "did the last
// attempt fail", so a caller knows whether retrying is worthwhile.
let loaded = false;

// Lets the kiosk's reconnect handler retry after a boot that happened offline —
// without it, such a kiosk stays silent for its entire session.
export function scanSoundsLoaded() {
  return loaded;
}

// Browsers require a user gesture before audio, and the allowance must be claimed
// SYNCHRONOUSLY inside the gesture's own handler. playScanSound() always runs
// after an `await` in doScan(), by which point the activation from the originating
// keydown has expired — which is why scan sounds failed 100% of the time, not
// intermittently.
//
// So: play a near-silent clip synchronously on the first real gesture this page
// sees. Once a page has played audio off a direct gesture, browsers allow later
// programmatic play() calls regardless of async gaps.
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
      // That gesture did not count (some browsers are picky about synthetic
      // events). Listeners stay attached so the next real one tries again.
    });
  };
  document.addEventListener('keydown', unlock);
  document.addEventListener('pointerdown', unlock);
}

export async function loadScanSounds() {
  const { data, error } = await ScanSoundsModel.list();
  if (error) return; // leave `loaded` false so the caller can retry
  const byPath = Object.fromEntries((data || []).map((o) => [o.name, o]));
  const next = {};
  for (const key of Object.keys(SOUND_KEYS)) {
    const obj = byPath[SOUND_KEYS[key]];
    // Cache-bust on updated_at: upsert keeps the same path, so without this the
    // browser keeps playing a stale clip after an admin swaps it.
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
  // inactive_employee stays silent rather than borrowing an unrelated clip that
  // would misrepresent the result.
  return null;
}

// Safe before loadScanSounds() resolves or after it fails — the bundled fallback
// means this never goes fully silent.
export function playScanSound(data) {
  const key = keyForResult(data);
  if (!key) return;
  const customUrl = urlsByKey?.[key];
  const fallbackUrl = FALLBACK_SOUND_PATHS[key];
  playUrl(customUrl || fallbackUrl, customUrl ? fallbackUrl : null);
}

function playUrl(url, retryFallbackUrl) {
  if (!url) return;
  const audio = new Audio(url);
  // An uploaded clip that fails to load (offline, never cached) retries once with
  // the bundled tone. Only the `error` event retries — a play() rejection is the
  // autoplay policy, which a different URL cannot fix.
  if (retryFallbackUrl) {
    audio.addEventListener('error', () => playUrl(retryFallbackUrl, null), { once: true });
  }
  audio.play().catch(() => {
    // Autoplay policy or a decode error. A missed sound must not break the scan
    // result on screen.
  });
}
