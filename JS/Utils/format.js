// Pure formatting helpers — no DOM, no state, safe to reuse anywhere.

export const esc = (s) =>
  (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const initials = (name) =>
  (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// The URL-building half of avatarHTML() below, split out so
// OfflineScanModel's prefetchPhotos() can construct the EXACT same URL
// (cache-busting param included) to warm the Service Worker's photo cache
// under the same key avatarHTML() will request later — building this in
// two places that could drift apart is exactly how the /thumbnail vs
// uc?export=view mismatch happened before (see sw.js's isPhotoRequest()
// comment); one function, two callers, avoids a repeat.
export const photoSrc = (photoUrl, cacheKey) => {
  if (!photoUrl) return null;
  const sep = photoUrl.includes('?') ? '&' : '?';
  return `${photoUrl}${sep}cb=${encodeURIComponent(cacheKey || '')}`;
};

// Bundled generic silhouette, shown when an employee HAS a photo_url but
// it can't be loaded right now — most notably offline, when the real
// photo was never cached (see sw.js's PHOTO_CACHE: cache-first, but only
// for what's actually been fetched before while online). Not used when
// there's no photo_url at all — see avatarHTML() below for why. Same
// "always something better than nothing" reasoning as scanSounds.js's
// bundled fallback tones for a kiosk that's never been online at all.
// Absolute path (not relative to Public/index.html) to match sw.js's
// precache list and scanSounds.js's FALLBACK_SOUND_PATHS convention —
// both need one path that resolves the same way from the Service
// Worker's root scope and from whatever page loads this file.
const DEFAULT_AVATAR_SRC = '/Public/Assets/EmployeePhoto/default-avatar.svg';

// Always rendered hidden, revealed by the real photo's onerror below.
// Its own onerror falls through to initials — in practice only reachable
// if this local static asset itself is missing.
const defaultAvatarImg = () =>
  `<img src="${DEFAULT_AVATAR_SRC}" alt="" style="display:none" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />`;

// Renders inside a `.avatar` div. photo_url in this app is a Google Drive
// thumbnail link (drive.google.com/thumbnail?id=...) tied to a fixed file
// id — replacing the photo in Drive keeps that same URL, and both the
// browser and Google's own thumbnail endpoint cache aggressively by URL,
// not by content. Appending `cacheKey` (pass the employee's updated_at,
// which bumps on any edit including a photo swap) as a query param forces
// the browser to treat a changed record as a new request instead of
// serving a stale cached image. It can't force Google's server-side
// thumbnail cache to refresh — that can occasionally lag behind a
// same-file-id replacement on Google's end — but it fixes the half of the
// problem this app controls.
//
// Two distinct "no real photo" cases, deliberately handled differently:
// - No `photo_url` on the record at all → straight to initials. There's
//   no photo to ever show for this person, so a generic silhouette would
//   just be a less-identifying initials circle, not a substitute for
//   anything.
// - A `photo_url` exists but can't be shown right now (offline and never
//   cached in PHOTO_CACHE, a dead/expired link, a transient load error)
//   → the bundled default-avatar image, then initials only if even that
//   local static asset somehow fails to load. This case specifically
//   means "this person does have a photo, we just can't reach it," which
//   is worth distinguishing from "no photo on file" on a kiosk screen.
//
// One retry before giving up to the default avatar: OfflineScanModel's
// doScan() kicks off a best-effort LIVE fetch for this exact photo in
// parallel with rendering this card (see StandaloneScanner.js) — covering
// the case where the general connection (and therefore Drive) is
// actually fine even though Supabase specifically just failed (the case
// that made this scan take the offline path at all). If that fetch wins
// the race and lands in sw.js's PHOTO_CACHE within ~1.2s, re-requesting
// the identical `src` picks up the real photo instead of settling for the
// silhouette on the very first failed attempt. Harmless if genuinely
// fully offline — the retry just fails the same way and falls through.
const PHOTO_RETRY_MS = 1200;
export const avatarHTML = (name, photoUrl, cacheKey) => {
  const initialsHTML = `<span class="avatar-fallback" style="display:none">${esc(initials(name))}</span>`;
  const src = photoSrc(photoUrl, cacheKey);
  if (!src) return `<span class="avatar-fallback">${esc(initials(name))}</span>`;
  const onerror = `if(this.dataset.retried!=='1'){this.dataset.retried='1';var im=this,s=this.src;setTimeout(function(){im.src=s;},${PHOTO_RETRY_MS});}else{this.style.display='none';this.nextElementSibling.style.display='';}`;
  const realHTML = `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-retried="0" onerror="${onerror}" />`;
  return realHTML + defaultAvatarImg() + initialsHTML;
};

export const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

// Used by Settings' scan-sounds storage summary. Binary (1024) units to
// match what Supabase Storage itself reports, not decimal (1000) —
// showing "4.8 MB" for a file Supabase's own dashboard calls 5 MiB would
// read as a mismatch even though both are "correct" by different
// conventions.
export const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

// Splits an array into fixed-size chunks — used to batch bulk inserts
// (e.g. CSV import) into a handful of round-trips instead of one per row.
export const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};