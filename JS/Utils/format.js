// Pure formatting helpers — no DOM, no state, safe to reuse anywhere.

export const esc = (s) =>
  (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export const initials = (name) =>
  (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

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
// problem this app controls, and self-heals via `onerror` (hides the
// broken image, reveals the initials fallback) instead of showing a
// broken-image icon if a link is ever invalid or briefly unavailable.
export const avatarHTML = (name, photoUrl, cacheKey) => {
  const fallback = `<span class="avatar-fallback">${esc(initials(name))}</span>`;
  if (!photoUrl) return fallback;
  const sep = photoUrl.includes('?') ? '&' : '?';
  const src = `${photoUrl}${sep}cb=${encodeURIComponent(cacheKey || '')}`;
  return `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />${fallback.replace('<span', '<span style="display:none;"')}`;
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

// Splits an array into fixed-size chunks — used to batch bulk inserts
// (e.g. CSV import) into a handful of round-trips instead of one per row.
export const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
