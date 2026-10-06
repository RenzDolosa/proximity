// Client-side image resizing via <canvas>, so a multi-megabyte phone photo is
// never uploaded at full resolution.
//
// canvas.toBlob() silently produces a different format than requested on
// browsers that cannot encode WebP — no throw, no warning. So never assume the
// output is .webp: read `blob.type` back and propagate that end-to-end
// (here -> EmployeeModal -> EmployeesModel -> upload-employee-photo), or Drive
// ends up with "*.webp" files containing JPEG bytes.
//
// HEIC/HEIF (the iPhone default) is not canvas-decodable in most browsers and
// fails here with a clear error. iPhone users should set Camera > Formats >
// Most Compatible, or pick an existing .jpg/.png.
const MAX_DIMENSION = 800; // px, longest side — plenty for a directory/ID photo
const WEBP_QUALITY = 0.85;

// The offline thumbnail is NOT an avatar: StandaloneScanner renders it at
// min(82dvh, 82dvw) (.ss-photo-stage), the most prominent image in the app.
//
// Sized down from 480px/q0.80 on 2026-10-06, where these measured ~17 KB each —
// 12.5 MB across 729 employees, the largest table in the database and the
// heaviest thing the kiosk cache downloads. Quality was the wasteful axis, not
// dimension: 400px is already upscaled on every kiosk display, and upscaling
// destroys exactly the detail the extra quality bits encode.
//
// Changing these only affects new uploads. Settings -> Offline scanner
// thumbnails re-encodes existing rows via recompressThumbBase64() below.
const OFFLINE_THUMB_MAX_DIMENSION = 400;
const OFFLINE_THUMB_QUALITY = 0.62;

export const OFFLINE_THUMB_TARGET = Object.freeze({
  maxDimension: OFFLINE_THUMB_MAX_DIMENSION,
  quality: OFFLINE_THUMB_QUALITY,
  // Stored (base64) size at or below which a row is left alone. Empirical, not
  // derived — it depends on the photos. Only filters which rows are worth
  // downloading to try; pickSmallerThumb() still decides every row it is handed.
  overTargetStoredBytes: 12288,
});

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
 * @param {File} file
 * @returns {Promise<{ blob: Blob, previewUrl: string, mimeType: string }>}
 *   mimeType is the format actually produced, not the one requested.
 *   Caller should URL.revokeObjectURL(previewUrl) once it is no longer shown.
 */
export async function fileToWebp(file) {
  if (!isImageFile(file)) throw new Error('Please choose an image file.');

  const bitmap = await loadBitmap(file);
  try {
    const blob = await bitmapToWebpBlob(bitmap, MAX_DIMENSION, WEBP_QUALITY);
    return { blob, previewUrl: URL.createObjectURL(blob), mimeType: blob.type || 'image/webp' };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

// The offline Scanner thumbnail. Decodes the file a second time rather than
// sharing fileToWebp's bitmap — this runs once per manual upload, not a hot
// path, and keeps the two functions independent.
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

// Decoded byte count without decoding: 4 base64 chars encode 3 bytes, padding
// encodes none. The recompressor's before/after accounting runs over hundreds of
// rows, where atob()-ing each one just to read .length would allocate megabytes.
// Note this is the IMAGE size, ~3/4 of the base64 text width the column stores.
export function base64ByteLength(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) return 0;
  const clean = base64.replace(/[\r\n=]/g, '');
  return Math.floor((clean.length * 3) / 4);
}

// Which of an original and a re-encoded thumbnail to keep.
//
// Re-encoding is not monotonically shrinking: a row already below the target is
// scaled back up to it and can come back larger, and a second pass costs a
// generation of quality for nothing. Both must keep the original, which is what
// makes the Settings action safely re-runnable. The 10% floor applies the same
// reasoning to marginal wins — not worth the quality loss, nor the UPDATE's own
// cost (every rewritten row shows up in the next scanner lookup delta).
const MIN_GAIN_RATIO = 0.1;

export function pickSmallerThumb(originalBase64, candidateBase64) {
  const before = base64ByteLength(originalBase64);
  const after = base64ByteLength(candidateBase64);
  if (!before || !after || after >= before * (1 - MIN_GAIN_RATIO)) {
    return { base64: originalBase64, before, after: before, saved: 0, changed: false };
  }
  return { base64: candidateBase64, before, after, saved: before - after, changed: true };
}

/**
 * Re-encodes a stored photo_thumb_b64 to the current offline target.
 *
 * Sourced from the stored bytes, not photo_url: Drive hot-links taint a
 * cross-origin canvas, while a data: URI from our own column has no origin — so
 * this also works for rows whose Drive file is gone. Returns the ORIGINAL
 * unchanged when the saving is not worth it (see pickSmallerThumb).
 *
 * @returns {Promise<{ base64: string, before: number, after: number, saved: number, changed: boolean }>}
 */
export async function recompressThumbBase64(base64) {
  if (!base64) return { base64, before: 0, after: 0, saved: 0, changed: false };

  const bitmap = await loadBitmap(base64ToBlob(base64, sniffImageMimeFromBase64(base64)));
  try {
    const blob = await bitmapToWebpBlob(bitmap, OFFLINE_THUMB_MAX_DIMENSION, OFFLINE_THUMB_QUALITY);
    return pickSmallerThumb(base64, await blobToBase64(blob));
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function bitmapToWebpBlob(bitmap, maxDimension, quality) {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not convert image — the file may be corrupt or an unsupported format (e.g. HEIC).'))),
      'image/webp',
      quality
    );
  });
}

async function loadBitmap(file) {
  // createImageBitmap avoids an <img> round-trip but cannot handle every source
  // type, so fall back to Image() rather than failing.
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch { /* fall through */ }
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

/** Blob to base64 (no data: prefix) for JSON transport to the Edge Function. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the converted image.'));
    reader.readAsDataURL(blob);
  });
}

// photo_thumb_b64 carries no stored mime type, and rows predating client-side
// conversion can be PNG or JPEG (Drive's /thumbnail picks its own format). A PNG
// labelled image/jpeg in a data: URI decodes as visual noise, not a broken-image
// icon — so sniff the real format from the magic bytes instead of trusting a
// hardcoded label. Only ~12 bytes are decoded, so every render can afford it.
const MAGIC_BYTES = [
  // WEBP is a RIFF container: the marker sits at offset 8, not byte 0. Checked
  // first since it is the common case for every client-side upload.
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

export function sniffImageMimeFromBase64(base64) {
  if (!base64) return 'image/jpeg'; // callers already treat falsy as "no photo"
  try {
    const head = atob(base64.slice(0, 24)); // 24 chars covers 16 bytes
    for (const { mime, bytes, offset = 0 } of MAGIC_BYTES) {
      if (head.length < offset + bytes.length) continue;
      if (bytes.every((b, i) => head.charCodeAt(offset + i) === b)) return mime;
    }
  } catch { /* malformed base64 — fall through */ }
  return 'image/jpeg';
}

/** A `data:` URI for a stored photo_thumb_b64, labelled with its sniffed type. */
export function photoDataUri(base64) {
  return `data:${sniffImageMimeFromBase64(base64)};base64,${base64}`;
}
