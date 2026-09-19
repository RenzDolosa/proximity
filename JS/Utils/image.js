// Converts any browser-decodable image (jpg, png, gif, bmp, and already
// -webp) into a resized Blob entirely client-side via <canvas> — used by
// EmployeeModal's photo upload so a phone-camera photo (often several MB)
// doesn't get uploaded at full resolution. fileToOfflineThumbWebp() below
// does the same thing at a smaller size/quality for the Scanner's offline
// result photo (employees.photo_thumb_b64).
//
// Preferred output is .webp, but canvas.toBlob() silently falls back to a
// different format (historically PNG, JPEG on some Android/WebView
// builds) on browsers that can't encode WebP — it does NOT throw or warn,
// it just gives back whatever it actually produced. Earlier code assumed
// the result was always .webp and hardcoded that filename/Content-Type
// all the way to the Edge Function, which is why some uploads showed up
// in Drive named "*.webp" while actually containing JPEG bytes. Fix:
// never assume — always read the real `blob.type` back and propagate
// *that* end-to-end (Utils/image.js -> EmployeeModal.js -> EmployeesModel
// -> upload-employee-photo Edge Function), so the filename/Content-Type
// Drive receives always matches the bytes actually being sent.
//
// Note: HEIC/HEIF (the default format on iPhones) is NOT decodable by
// <canvas> in most browsers today — those files will fail here with a
// clear error rather than silently producing a broken image. iPhone users
// should either enable "Most Compatible" (Settings > Camera > Formats) so
// photos save as .jpg, or pick an existing .jpg/.png from their library.
const MAX_DIMENSION = 800; // px, longest side — plenty for a directory/ID photo
const WEBP_QUALITY = 0.85;

// The Scanner's offline result photo (see StandaloneScanner.js's
// .ss-photo-stage) displays at up to min(82dvh, 82dvw) — several hundred
// px on a real kiosk display. The OLD offline thumbnail this replaces was
// a server-side Drive fetch at a fixed `sz=w96` (see
// upload-employee-photo/index.ts's change log), which looked fine at its
// original small size but turns visibly blurry blown up to fill most of
// the screen. 480px keeps it sharp at that display size without the
// base64 payload getting out of hand — this rides in
// get_scanner_offline_photos(), refreshed only every 30 minutes (see
// OfflineScanModel.js), not the frequent 5-minute lookup cache, so it can
// afford to be bigger than a typical "avatar" thumbnail.
const OFFLINE_THUMB_MAX_DIMENSION = 480;
const OFFLINE_THUMB_QUALITY = 0.8;

export const EXTENSION_BY_MIME = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function extensionForMime(mime) {
  return EXTENSION_BY_MIME[mime] || 'jpg';
}

export function isImageFile(file) {
  return !!file && file.type.startsWith('image/');
}

/**
 * @param {File} file - the raw file the user picked
 * @returns {Promise<{ blob: Blob, previewUrl: string, mimeType: string }>}
 *   blob: the converted image, ready to upload — usually .webp, but check
 *   `mimeType` (== blob.type) rather than assuming, since the browser may
 *   have silently produced a different format.
 *   previewUrl: an object URL for immediate <img> preview — caller should
 *   URL.revokeObjectURL(previewUrl) when it's no longer shown
 */
export async function fileToWebp(file) {
  if (!isImageFile(file)) throw new Error('Please choose an image file.');

  const bitmap = await loadBitmap(file);
  try {
    const blob = await bitmapToWebpBlob(bitmap, MAX_DIMENSION, WEBP_QUALITY);
    // blob.type is the ACTUAL format the browser produced — trust this, not
    // the 'image/webp' we requested above.
    return { blob, previewUrl: URL.createObjectURL(blob), mimeType: blob.type || 'image/webp' };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

// Same idea as fileToWebp above, sized and compressed for the offline
// Scanner's stored thumbnail instead of the full directory photo — see
// OFFLINE_THUMB_MAX_DIMENSION's comment. Decodes the file a second time
// rather than sharing fileToWebp's bitmap: this only runs once per manual
// admin photo upload, not a hot path, and keeping the two functions
// independent means neither has to change shape to accommodate the other.
export async function fileToOfflineThumbWebp(file) {
  if (!isImageFile(file)) throw new Error('Please choose an image file.');

  const bitmap = await loadBitmap(file);
  try {
    const blob = await bitmapToWebpBlob(bitmap, OFFLINE_THUMB_MAX_DIMENSION, OFFLINE_THUMB_QUALITY);
    return { blob, mimeType: blob.type || 'image/webp' };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

async function bitmapToWebpBlob(bitmap, maxDimension, quality) {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not convert image — the file may be corrupt or an unsupported format (e.g. HEIC).'))),
      'image/webp',
      quality
    );
  });
}

async function loadBitmap(file) {
  // createImageBitmap is faster and avoids an <img> round-trip, but isn't
  // universally available — fall back to the classic Image() approach.
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path (some browsers can't createImageBitmap
      // from every source type, e.g. certain HEIC-adjacent edge cases)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read this image file.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Converts a Blob to a base64 string (no data: prefix) for JSON transport to the Edge Function. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the converted image.'));
    reader.readAsDataURL(blob);
  });
}

// employees.photo_thumb_b64: as of the fileToOfflineThumbWebp() function
// above, produced CLIENT-SIDE (guaranteed .webp, sniffing below will
// always confirm it) and sent to upload-employee-photo alongside the main
// photo. Only falls back to a server-side Drive `/thumbnail?...` fetch
// (see that function's index.ts) if the client somehow didn't supply one
// — and that fallback, like every row uploaded before this function
// existed, can be PNG or JPEG: Drive's `/thumbnail` responds with
// whatever format it decides to generate the preview in (observed both
// PNG and JPEG across employees), with no Content-Type captured alongside
// the stored bytes to tell them apart later. A PNG-formatted thumbnail
// labeled `image/jpeg` in a data: URI decodes as visual garbage (static/
// noise) instead of either the real photo or a clean broken-image icon.
// Root cause confirmed 2026-09-19 by pulling live rows via Supabase MCP:
// 6 of 9 employees had PNG signatures despite every call site hardcoding
// `data:image/jpeg;base64,`.
//
// Fixed client-side, once, here: sniff the real format from the first few
// decoded bytes (the same magic-number check a file(1)-style tool uses)
// instead of trusting a hardcoded label. Only decodes ~12 bytes via atob()
// — cheap regardless of the thumbnail's actual size — so every caller can
// afford to sniff on every render rather than caching a mime alongside the
// base64 (which would mean a schema/Edge-Function change; this doesn't).
// Kept even though new uploads are always webp now: every row stored
// before this change still needs it, and it's a harmless no-op cost on a
// row that's already webp (matches on the very first entry in the list).
const MAGIC_BYTES = [
  // WEBP is a RIFF container ("RIFF" + 4-byte size + "WEBP"); the "WEBP"
  // tag sits at offset 8, so this needs the offset form below rather than
  // a plain byte-0 prefix like the others. Checked first since it's the
  // common case for every upload since fileToOfflineThumbWebp() started
  // producing these client-side.
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

export function sniffImageMimeFromBase64(base64) {
  if (!base64) return 'image/jpeg'; // no bytes to sniff — harmless fallback, offlineAvatarHTML/showHeroPhoto already treat falsy base64 as "no photo" before this is ever called
  try {
    // 16 raw bytes needs at most 22 base64 chars (4 chars encode 3 bytes);
    // slicing generously up front keeps this a single atob() call.
    const head = atob(base64.slice(0, 24));
    for (const { mime, bytes, offset = 0 } of MAGIC_BYTES) {
      if (head.length < offset + bytes.length) continue;
      if (bytes.every((b, i) => head.charCodeAt(offset + i) === b)) return mime;
    }
  } catch {
    // Malformed base64 — fall through to the default below rather than
    // throwing out of what's meant to be a display-only helper.
  }
  return 'image/jpeg'; // unrecognized signature — same default this code path always used before sniffing existed
}

/** Builds a `data:` URI for a stored `photo_thumb_b64` value, labeled with its real sniffed mime type rather than an assumed one. */
export function photoDataUri(base64) {
  return `data:${sniffImageMimeFromBase64(base64)};base64,${base64}`;
}