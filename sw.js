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
// Deliberately NOT intercepted: any Supabase request other than the
// scan-sounds public object URLs (REST/Auth/RPC/Storage-list calls must
// always hit the real network or fail visibly — caching one of those
// could serve stale auth state, or silently swallow a real error the
// offline-queue logic in OfflineScanModel.js needs to actually see), and
// any non-GET request (writes/RPCs must never be intercepted at all).

const APP_CACHE = 'proximity-app-v1';
const SOUND_CACHE = 'proximity-sounds-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
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
    .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  return cached || (await networkPromise) || new Response(null, { status: 504, statusText: 'Offline and not cached' });
}