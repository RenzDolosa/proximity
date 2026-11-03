// The arithmetic behind a progress bar's width.
//
// Pure and separate from Utils/xhrUpload.js because that module imports the
// Supabase client, which needs a browser — same split as Utils/scanTone.js and
// Utils/scanSoundKeys.js, for the same reason.
//
// Worth testing on its own: a bar that paints the wrong width is not a cosmetic
// bug, it is a lie about whether it is safe to walk away. The previous
// indeterminate style sat at `width: 100%` whenever the length was unknown,
// which read as finished while bytes were still going.

/**
 * @returns {number|null} 0-100, or null when progress genuinely cannot be
 *   known — the caller's signal to show an indeterminate bar rather than
 *   paint a number it invented.
 */
export function progressPercent(loaded, total) {
  const l = toFinite(loaded);
  const t = toFinite(total);
  if (Number.isNaN(l) || Number.isNaN(t) || t <= 0 || l < 0) return null;
  // Clamped: some browsers report loaded > total once the last chunk is
  // flushed, and an unclamped fill runs past the end of its rounded track.
  return Math.max(0, Math.min(100, Math.round((l / t) * 100)));
}

// Number(null) and Number('') are both 0, not NaN — so a missing value would
// otherwise read as "zero bytes sent" and paint a 0% bar that never moves,
// which is the stuck-looking state this whole function exists to avoid. These
// have to be rejected before the coercion, not after it.
function toFinite(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}
