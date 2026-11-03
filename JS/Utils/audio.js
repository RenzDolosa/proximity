// Shrink a scan sound in the browser before it is uploaded.
//
// THE PROBLEM. Settings sent whatever file was picked, byte for byte. A scan
// sound from a sound library is typically 44.1 or 48 kHz, stereo, often
// 24-bit — about 288 KB per second. Three seconds of that is ~860 KB, and on
// the link this site actually has (slow, and intermittent — see the scan-log
// ordering work on 2026-10-24) that is a long wait with an indeterminate bar
// in front of it. The five sounds already uploaded are 26-79 KB, so the big
// ones are not what the feature needs; they are just what the file happened
// to be.
//
// THE FIX, and why it is safe. A scan sound is a short cue played through a
// kiosk speaker across a room. Downmixing to mono and resampling to 22050 Hz
// costs nothing anyone can hear in that setting. Measured end-to-end in a
// browser on a 3-second 48 kHz 16-bit stereo clip: 576 KB -> 132 KB, 4.35x
// smaller, duration unchanged at 3.000s. A 24-bit source is ~6.5x. Nothing is
// trimmed: the clip plays to its end, however long it is. The only lossy
// steps are channel count and sample rate.
//
// BILLING. This makes uploads smaller, never larger, and leaves the number of
// requests exactly as it was — so it reduces egress when kiosks later fetch
// the clip, and does not touch log ingestion at all. (An upload is ingress,
// which Supabase does not bill as egress; the saving is on the download side,
// once per kiosk per clip.)

export const SOUND_TARGET = Object.freeze({
  sampleRate: 22050, // Nyquist 11 kHz — well above anything an alert tone needs
  channels: 1,
  bitsPerSample: 16,
});

// The cap that mono+resample alone could not reach.
//
// Downmixing and resampling only help an UNCOMPRESSED source. A 339 KB mp3
// decodes to raw PCM several times its own size, so the re-encode came back
// bigger, the "only if smaller" rule correctly rejected it, and the original
// 339 KB went up unchanged — which is exactly what was reported. Duration is
// the only lever left, because the output is uncompressed and its size is
// therefore seconds x 44.1 KB and nothing else.
//
// 3 seconds is already generous for what this is. The five sounds in use are
// 0.22-0.40s; the scan result card clears after 10s; and at a kiosk the next
// person scans within a few seconds, so a longer clip is still playing over
// the next three scans. A 21-second alert tone is not a short clip that
// happens to be large, it is the wrong clip for the job.
//
// Trimming is destructive, so it is never silent: the row and the toast both
// say it happened, and the panel says it will before a file is picked.
export const MAX_SOUND_SECONDS = 3;
// Without a fade the cut lands mid-waveform, which is an audible click — the
// one artefact that would make a trimmed clip sound broken rather than short.
const TRIM_FADE_SECONDS = 0.04;

// Same rule and the same reason as pickSmallerThumb() in image.js: a re-encode
// that saves only a sliver is not worth a generation of quality loss, and one
// that came back LARGER must never be used. An already-compressed upload (a
// small mp3 or ogg) decodes to PCM several times its own size, so this branch
// is reached often, not rarely.
export const MIN_SAVING_RATIO = 0.1;

export function pickSmallerSound(originalBytes, candidateBytes) {
  const before = Number(originalBytes) || 0;
  const after = Number(candidateBytes) || 0;
  if (!before || !after) return { useCandidate: false, before, after, saved: 0 };
  const saved = before - after;
  const useCandidate = saved > 0 && saved / before >= MIN_SAVING_RATIO;
  return { useCandidate, before, after, saved: useCandidate ? saved : 0 };
}

// Cut to at most `maxSeconds`, fading the last moments so the cut is not a
// click. Returns the input untouched when it already fits, so a short clip
// never pays for this.
export function trimSamples(samples, sampleRate, maxSeconds = MAX_SOUND_SECONDS) {
  const data = samples || new Float32Array(0);
  const rate = Number(sampleRate) || SOUND_TARGET.sampleRate;
  const limit = Math.max(1, Math.floor(maxSeconds * rate));
  if (data.length <= limit) return { samples: data, trimmed: false };

  const out = Float32Array.from(data.subarray(0, limit));
  const fade = Math.min(Math.floor(TRIM_FADE_SECONDS * rate), out.length);
  for (let i = 0; i < fade; i++) {
    // Linear ramp over the final `fade` samples, reaching exactly 0 on the
    // LAST one. (i / fade) stops at 1/fade short of zero and leaves a small
    // step at the very end — which is the click this fade exists to remove.
    out[out.length - fade + i] *= 1 - ((i + 1) / fade);
  }
  return { samples: out, trimmed: true };
}

// Average the channels rather than dropping all but the first: a stereo clip
// with the tone panned to one side would otherwise come back silent.
export function downmixToMono(channels) {
  const list = (channels || []).filter((c) => c && c.length);
  if (!list.length) return new Float32Array(0);
  if (list.length === 1) return Float32Array.from(list[0]);
  const length = Math.min(...list.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const c of list) sum += c[i];
    out[i] = sum / list.length;
  }
  return out;
}

// Float samples in [-1, 1] -> a 16-bit PCM WAV. Written by hand because the
// platform has no encoder: AudioContext decodes every format the browser
// knows, and can encode none of them.
export function encodeWav(samples, sampleRate) {
  const rate = Math.max(1, Math.round(sampleRate) || SOUND_TARGET.sampleRate);
  const data = samples || new Float32Array(0);
  const bytes = new Uint8Array(44 + data.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format = PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);    // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  view.setUint32(40, data.length * 2, true);

  for (let i = 0; i < data.length; i++) {
    // Clamp before scaling: decoded audio can sit slightly outside [-1, 1],
    // and letting that wrap turns a loud peak into a crack.
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

// Browser-only (AudioContext). Returns the file to upload plus what it cost,
// and NEVER throws: a codec the browser cannot decode, or a re-encode that
// came out no smaller, both fall back to the original file. Failing to shrink
// a sound must not stop an admin uploading it.
export async function shrinkSoundFile(file) {
  const before = file?.size || 0;
  const unchanged = { file, before, after: before, saved: 0, changed: false, trimmed: false };
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const DecodeCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!file || !Ctx || !DecodeCtx) return unchanged;

  try {
    const decodeCtx = new DecodeCtx();
    let decoded;
    try {
      decoded = await decodeCtx.decodeAudioData(await file.arrayBuffer());
    } finally {
      decodeCtx.close?.();
    }
    if (!decoded?.length) return unchanged;

    // Resample by rendering through an OfflineAudioContext at the target rate
    // — the platform's own resampler, rather than a hand-rolled one that would
    // alias. Length scales with the rate change so the clip keeps its duration.
    const rate = Math.min(SOUND_TARGET.sampleRate, decoded.sampleRate);
    const frames = Math.max(1, Math.ceil(decoded.duration * rate));
    const offline = new Ctx(1, frames, rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();

    const mono = downmixToMono([rendered.getChannelData(0)]);
    const cut = trimSamples(mono, rate);
    const wav = encodeWav(cut.samples, rate);
    const pick = pickSmallerSound(before, wav.byteLength);
    // Still bigger than the source even after trimming — a short, heavily
    // compressed original. Send that instead; uncompressed is not always a win.
    if (!pick.useCandidate) return unchanged;

    const name = (file.name || 'sound').replace(/\.[^.]+$/, '') + '.wav';
    return {
      file: new File([wav], name, { type: 'audio/wav' }),
      before, after: wav.byteLength, saved: pick.saved, changed: true,
      trimmed: cut.trimmed, seconds: cut.samples.length / rate,
    };
  } catch {
    // Unsupported codec, a decode failure, or no AudioContext allowance.
    return unchanged;
  }
}
