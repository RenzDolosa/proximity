// Converts any browser-decodable image (jpg, png, gif, bmp, and already
// -webp) into a resized Blob entirely client-side via <canvas> — used by
// EmployeeModal's photo upload so a phone-camera photo (often several MB)
// doesn't get uploaded at full resolution.
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
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not convert image — the file may be corrupt or an unsupported format (e.g. HEIC).'))),
      'image/webp',
      WEBP_QUALITY
    );
  });

  // blob.type is the ACTUAL format the browser produced — trust this, not
  // the 'image/webp' we requested above.
  return { blob, previewUrl: URL.createObjectURL(blob), mimeType: blob.type || 'image/webp' };
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
