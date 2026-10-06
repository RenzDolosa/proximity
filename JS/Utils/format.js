// Pure formatting helpers — no DOM, no state, safe to reuse anywhere.
import { photoDataUri } from './image.js';

export const esc = (s) =>
  (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const initials = (name) =>
  (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// Split out of avatarHTML so OfflineScanModel's prefetch can build the exact
// same URL (cache-busting param included) and warm the Service Worker cache
// under the key avatarHTML will later request. Two call sites, one function —
// building it twice is how the /thumbnail vs uc?export=view mismatch happened.
export const photoSrc = (photoUrl, cacheKey) => {
  if (!photoUrl) return null;
  const sep = photoUrl.includes('?') ? '&' : '?';
  return `${photoUrl}${sep}cb=${encodeURIComponent(cacheKey || '')}`;
};

// Absolute path, matching sw.js's precache list — it must resolve identically
// from the Service Worker's root scope and from any page importing this.
const DEFAULT_AVATAR_SRC = '/Public/Assets/EmployeePhoto/default-avatar.svg';

const defaultAvatarImg = () =>
  `<img src="${DEFAULT_AVATAR_SRC}" alt="" style="display:none" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />`;

// Renders inside a `.avatar` div, from the live Drive photo.
//
// Drive thumbnail links are tied to a fixed file id, so replacing a photo keeps
// the same URL — and both the browser and Google cache by URL, not content.
// Passing the employee's updated_at as `cacheKey` forces a fresh request. It
// cannot flush Google's own server-side thumbnail cache, which can lag a
// same-file-id replacement, but it fixes the half this app controls.
//
// Two distinct "no real photo" cases:
// - no photo_url at all → initials, since a generic silhouette would identify
//   the person less well than their own initials.
// - photo_url present but unreachable (offline and never cached, dead link) →
//   the bundled silhouette, then initials only if that local asset also fails.
//   On a kiosk, "has a photo, can't reach it" is worth distinguishing.
//
// One retry before giving up: OfflineScanModel's doScan kicks off a live fetch
// for this same photo in parallel, covering the case where Drive is reachable
// even though Supabase just failed. If it lands in PHOTO_CACHE within ~1.2s the
// identical src picks up the real photo. Harmless when genuinely offline.
const PHOTO_RETRY_MS = 1200;
export const avatarHTML = (name, photoUrl, cacheKey) => {
  const initialsHTML = `<span class="avatar-fallback" style="display:none">${esc(initials(name))}</span>`;
  const src = photoSrc(photoUrl, cacheKey);
  if (!src) return `<span class="avatar-fallback">${esc(initials(name))}</span>`;
  const onerror = `if(this.dataset.retried!=='1'){this.dataset.retried='1';var im=this,s=this.src;setTimeout(function(){im.src=s;},${PHOTO_RETRY_MS});}else{this.style.display='none';this.nextElementSibling.style.display='';}`;
  const realHTML = `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-retried="0" onerror="${onerror}" />`;
  return realHTML + defaultAvatarImg() + initialsHTML;
};

// Scanner-only: renders from the locally-cached employees.photo_thumb_b64 as an
// inline data: URI, so it looks identical online or fully offline with no
// request at all. Employee Manager and Directory keep avatarHTML's live photo —
// they are always online, so there is no reason to show a thumbnail there.
//
// Format is sniffed, not assumed (see photoDataUri): rows predating client-side
// conversion can be PNG or JPEG, and a PNG labelled image/jpeg decodes as
// visual static rather than a clean broken-image icon.
export const offlineAvatarHTML = (name, thumbB64) => {
  const initialsHTML = `<span class="avatar-fallback" style="display:none">${esc(initials(name))}</span>`;
  if (!thumbB64) return `<span class="avatar-fallback">${esc(initials(name))}</span>`;
  const realHTML = `<img src="${photoDataUri(thumbB64)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display=''" />`;
  return realHTML + initialsHTML;
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

// Binary (1024) units to match what Supabase Storage reports. Utils/usage.js
// uses decimal units deliberately, for figures shown next to Supabase's own
// billing pages.
export const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

// Batches bulk inserts (e.g. CSV import) into a few round-trips, not one per row.
export const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
