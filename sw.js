// Service Worker: makes the app shell itself (HTML/CSS/JS/vendor) able to
// load with no network at all — scan handling while offline is a
// separate concern, see JS/Models/OfflineScanModel.js. Registered from
// JS/main.js as `/sw.js` (absolute root path), which is why this file
// lives at the repo root rather than inside Public/ — see the comment
// there for why a Public/sw.js couldn't work given this repo's layout
// (index.html in Public/, JS/ and CSS/ as siblings, not children).
//
// Two independent caches:
// - APP_CACHE: this app's own static files. Network-first, so a normal
//   online load always gets whatever's actually live, falling back to
//   the last successfully-cached copy only when the network request
//   itself fails outright.
// - SOUND_CACHE: the public scan-sounds bucket's audio files. Cache-first
//   with a background refresh — these change rarely (an admin replacing
//   one in Settings) and losing scan-feedback audio during an outage is
//   a real UX regression worth avoiding, unlike app code where serving a
//   few-seconds-stale version while online would be actively worse.
//
// There used to be a third cache here (PHOTO_CACHE, for employee photos
// fetched live from Google Drive) plus a whole roster-wide background
// prefetcher in OfflineScanModel.js to keep it warm. Deleted 2026-09-18:
// employees.photo_thumb_b64 (a small base64 JPEG, produced server-side by
// upload-employee-photo at upload time, stored directly on the row) makes
// all of that unnecessary for the offline Scanner — there's nothing left
// to prefetch or cache, since the thumbnail already rides along in every
// scan response. See Supabase/README.md's matching change log entry.
// `activate` below will clean up any leftover `proximity-photos-v1` cache
// still sitting on an already-deployed kiosk from before this change, the
// same way it always prunes any cache name it doesn't recognize.
//
// avatarHTML()'s own default-avatar fallback (Employee Manager/Directory,
// still Drive-URL-based and unaffected by any of this — see
// Utils/format.js) is unrelated to PHOTO_CACHE's removal; DEFAULT_AVATAR_URL
// below is precached independently of it.
const APP_CACHE = 'proximity-app-v1';
const SOUND_CACHE = 'proximity-sounds-v1';

// Bundled fallback scan sounds — precached at install time (not lazily on
// first fetch, unlike everything else this file caches) specifically so
// they're available on a device's very first-ever load with no network,
// not just after "was online with this app once already". Keep this list,
// Utils/scanSounds.js's FALLBACK_SOUND_PATHS, and the actual files under
// Public/Assets/Sounds/ in sync — three places that all need to agree on
// the same 5 filenames.
const FALLBACK_SOUND_URLS = [
  '/Public/Assets/Sounds/matched-in.wav',
  '/Public/Assets/Sounds/matched-out.wav',
  '/Public/Assets/Sounds/card-revoked.wav',
  '/Public/Assets/Sounds/unmatched.wav',
  '/Public/Assets/Sounds/unassigned-card.wav',
];

// Same reasoning, one file: the generic default-avatar silhouette
// Utils/format.js's avatarHTML() falls back to when an employee has no
// photo_url at all, or the real Drive photo fails to load (Employee
// Manager/Directory only — the Scanner uses offlineAvatarHTML()'s base64
// thumbnail instead and never reaches this fallback at all). Precached
// here for the same "available from the literal first load, online or
// not" guarantee as the sounds above — keep this path in sync with
// Utils/format.js's DEFAULT_AVATAR_SRC.
const DEFAULT_AVATAR_URL = '/Public/Assets/EmployeePhoto/default-avatar.svg';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // addAll() is all-or-nothing — if precaching failed (e.g. this install
    // itself has no network yet, on a repeat install), that's fine: these
    // files fall back to APP_CACHE's normal network-first-with-fallback
    // handling below like everything else, they just lose the "available
    // from the very first offline load" guarantee until a later install
    // succeeds. Never block/fail activation over this.
    await cache.addAll([...FALLBACK_SOUND_URLS, DEFAULT_AVATAR_URL]).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, SOUND_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isSoundRequest(url) {
  return url.pathname.includes('/storage/v1/object/public/scan-sounds/');
}

function isOtherSupabaseRequest(url) {
  return /\.supabase\.co$/.test(url.hostname) && !isSoundRequest(url);
}

// Deliberately NOT intercepted: any Supabase request other than the
// scan-sounds public object URLs (REST/Auth/RPC/Storage-list calls must
// always hit the real network or fail visibly — caching one of those
// could serve stale auth state, or silently swallow a real error the
// offline-queue logic in OfflineScanModel.js needs to actually see), and
// any non-GET request (writes/RPCs must never be intercepted at all).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes/RPCs — let them hit the network untouched

  const url = new URL(req.url);

  if (isOtherSupabaseRequest(url)) return; // REST/Auth/RPC/Storage-list: always real network, never cached

  if (isSoundRequest(url)) {
    event.respondWith(cacheFirstWithRefresh(req, SOUND_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstWithCacheFallback(req, APP_CACHE));
  }
  // Anything else (Google Fonts, etc.) — left to the browser's own HTTP
  // cache; not worth a dedicated SW cache entry.
});

async function networkFirstWithCacheFallback(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw new Error(`offline and not yet cached: ${req.url}`);
  }
}

async function cacheFirstWithRefresh(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      // A cross-origin request the browser sent as no-cors (which is what
      // an <audio>/<img> tag loading a third-party URL does BY DEFAULT
      // with no `crossorigin` attribute set — see scanSounds.js's
      // playUrl(), which doesn't set one) always comes back as an
      // "opaque" response: status 0, ok:false, no matter whether the
      // request actually succeeded. The browser hides those details on
      // purpose so a page can't probe a cross-origin resource's real
      // status. Cache opaque responses unconditionally alongside genuine
      // res.ok successes; there's nothing else available to check them
      // against, and that's the accepted tradeoff for caching third-party
      // resources at all. (This used to matter for a Drive PHOTO_CACHE
      // too — removed 2026-09-18, see this file's top-of-file comment —
      // but still applies to the scan-sounds bucket here.)
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || new Response(null, { status: 504, statusText: 'Offline and not cached' });
}