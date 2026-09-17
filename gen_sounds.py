#!/usr/bin/env python3
"""Generate the 5 bundled fallback scan sounds under Public/Assets/Sounds/.

These are the offline-first "always available" tones `sw.js` precaches at
install time and `JS/Utils/scanSounds.js`'s FALLBACK_SOUND_PATHS falls back
to when an admin hasn't uploaded a custom clip (or the custom one fails to
load offline). They are intentionally short, simple synthesized tones --
NOT meant to sound as polished as whatever an admin uploads later -- just
distinct enough per outcome that a kiosk has *some* audible feedback from
its very first scan, online or not.

Run with: python3 gen_sounds.py
Requires only the standard library (wave + math + struct) -- no numpy, no
external deps, so it can run in CI or on a fresh machine with nothing else
installed.

Keep the 5 filenames here in sync with:
  - sw.js's FALLBACK_SOUND_URLS
  - JS/Utils/scanSounds.js's FALLBACK_SOUND_PATHS
  - Public/Assets/Sounds/ (the actual files this script writes)
"""
import wave
import struct
import math
import os

SAMPLE_RATE = 44100
AMPLITUDE = 0.35  # headroom below full scale; these play right after a
                   # kiosk beep/keypress and shouldn't be jarring

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sounds")


def _tone(freq, duration, amp=AMPLITUDE, fade=0.008):
    """One sine tone, in seconds, with a short linear fade in/out to avoid
    a click at the start/end of the clip."""
    n = int(SAMPLE_RATE * duration)
    fade_n = max(1, int(SAMPLE_RATE * fade))
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = 1.0
        if i < fade_n:
            env = i / fade_n
        elif i > n - fade_n:
            env = (n - i) / fade_n
        samples.append(amp * env * math.sin(2 * math.pi * freq * t))
    return samples


def _silence(duration):
    return [0.0] * int(SAMPLE_RATE * duration)


def _square_buzz(freq, duration, amp=AMPLITUDE, fade=0.01):
    """A harsher tone for negative outcomes -- a few odd harmonics mixed
    in on top of the fundamental, instead of a pure sine, so it reads as
    a "buzz"/error rather than a musical note."""
    n = int(SAMPLE_RATE * duration)
    fade_n = max(1, int(SAMPLE_RATE * fade))
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = 1.0
        if i < fade_n:
            env = i / fade_n
        elif i > n - fade_n:
            env = (n - i) / fade_n
        val = (
            math.sin(2 * math.pi * freq * t)
            + 0.5 * math.sin(2 * math.pi * freq * 3 * t)
            + 0.3 * math.sin(2 * math.pi * freq * 5 * t)
        ) / 1.8
        samples.append(amp * env * val)
    return samples


def _write_wav(path, samples):
    with wave.open(path, "w") as f:
        f.setnchannels(1)
        f.setsampwidth(2)  # 16-bit
        f.setframerate(SAMPLE_RATE)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * 32767))))
            for s in samples
        )
        f.writeframes(frames)


def build():
    os.makedirs(OUT_DIR, exist_ok=True)

    # matched_in: pleasant two-note ASCENDING chime -- entry granted
    matched_in = _tone(880, 0.09) + _silence(0.02) + _tone(1318.5, 0.14)

    # matched_out: the mirror -- two-note DESCENDING chime -- exit granted.
    # Deliberately the same two notes as matched_in, reversed, so the pair
    # reads as "the same family of sound" (both positive) while still
    # being distinguishable in/out at a glance... er, a listen.
    matched_out = _tone(1318.5, 0.09) + _silence(0.02) + _tone(880, 0.14)

    # card_revoked: low harsh buzz -- access denied. The most "negative"
    # sounding of the three non-matched outcomes since it's the clearest
    # security-relevant one (an active card that's been explicitly revoked).
    card_revoked = _square_buzz(196, 0.40)

    # unmatched: short double low-beep -- code not recognized at all.
    # Distinct rhythm (two short beeps) from card_revoked's single
    # sustained buzz, so the two "somethings wrong" outcomes don't sound
    # identical.
    unmatched = _tone(220, 0.09) + _silence(0.06) + _tone(220, 0.09)

    # unassigned_card: single mid warning tone -- a real card that simply
    # isn't linked to an employee yet. Meant to read as "notice" rather
    # than "denied": a plain sine (no harsh harmonics), pitched between
    # the positive chimes and the two error tones.
    unassigned_card = _tone(523.25, 0.22)

    _write_wav(os.path.join(OUT_DIR, "matched-in.wav"), matched_in)
    _write_wav(os.path.join(OUT_DIR, "matched-out.wav"), matched_out)
    _write_wav(os.path.join(OUT_DIR, "card-revoked.wav"), card_revoked)
    _write_wav(os.path.join(OUT_DIR, "unmatched.wav"), unmatched)
    _write_wav(os.path.join(OUT_DIR, "unassigned-card.wav"), unassigned_card)

    for name in ("matched-in.wav", "matched-out.wav", "card-revoked.wav", "unmatched.wav", "unassigned-card.wav"):
        p = os.path.join(OUT_DIR, name)
        print(f"wrote {p} ({os.path.getsize(p)} bytes)")


if __name__ == "__main__":
    build()
