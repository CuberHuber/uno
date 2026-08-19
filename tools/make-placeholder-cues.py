#!/usr/bin/env python3
# Synthesize placeholder sounds for all fifteen cues, until the real foley arrives.
#
#   python3 tools/make-placeholder-cues.py
#
# These are stand-ins built to the letter of design/audio-spec.md — physical, dry,
# frequency-aware — but they are DSP, not a microphone next to a real deck, and the
# spec still stands: the sound engineer's WAVs replace these by overwriting the same
# fifteen names in client/public/audio/.
#
# Two kinds of material:
#
#   * Card foley (play, action, draw, shuffle, deal, slam, penalty, wild, reject)
#     is filtered noise: a card slap is a band-passed burst with an instant attack
#     over a low-passed body, a riffle is a run of 6 ms ticks accelerating, a slide
#     is shaped noise amplitude-modulated at ~100 Hz like a card dragged over a stack.
#
#   * The wooden family (turn, uno, caught, seat, press) is sliced from a real
#     recording — Small Wood Sticks from the Logic Pro sound library, 44 discrete
#     hits, pitched and gated per cue. Apple's license covers using its audio
#     content inside your own works; the raw sample is not redistributed, only
#     short processed hits. If the sample is missing the script falls back to a
#     synthetic knock, so the build does not depend on that machine.
#
# Every cue is mono 48 kHz, peaks at -3 dBFS, starts on its attack (zero leading
# silence — the animation must not wait), fades inside the file, and stays within
# the length budget of the spec's table. Encoded to AAC 64k; the whole set must
# stay under the spec's 100 KB. The fixed RNG seed makes reruns byte-stable.
import os
import subprocess
import numpy as np

SR = 48000
OUT = "client/public/audio"
PREVIEW = os.path.join(os.environ.get("PREVIEW_DIR", ".audio-preview"), "cues")
STICKS = ("/Library/Application Support/Logic/Alchemy Samples/"
          "Sound Effects/Foley/Small Wood Sticks.wav")

rng = np.random.default_rng(20260819)


def seconds(dur: float) -> int:
    return int(round(dur * SR))


def noise(dur: float):
    return rng.standard_normal(seconds(dur))


def biquad(x, kind: str, freq: float, q: float = 0.707):
    """RBJ cookbook biquad, direct form II transposed. Slow but dependency-free."""
    w0 = 2 * np.pi * freq / SR
    alpha = np.sin(w0) / (2 * q)
    cosw = np.cos(w0)
    if kind == "lp":
        b0, b1, b2 = (1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2
    elif kind == "hp":
        b0, b1, b2 = (1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2
    else:  # "bp", constant peak gain
        b0, b1, b2 = alpha, 0.0, -alpha
    a0 = 1 + alpha
    b0, b1, b2 = b0 / a0, b1 / a0, b2 / a0
    a1, a2 = -2 * cosw / a0, (1 - alpha) / a0
    y = np.empty_like(x)
    z1 = z2 = 0.0
    for i in range(len(x)):
        yi = b0 * x[i] + z1
        z1 = b1 * x[i] - a1 * yi + z2
        z2 = b2 * x[i] - a2 * yi
        y[i] = yi
    return y


def env(x, attack: float = 0.001, tau: float = 0.05):
    """Instant-ish attack, exponential decay — the shape of something being hit."""
    tt = np.arange(len(x)) / SR
    e = np.exp(-tt / tau)
    if attack > 0:
        e *= np.minimum(tt / attack, 1.0)
    return x * e


def damped_sine(freq: float, dur: float, tau: float):
    tt = np.arange(seconds(dur)) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt / tau)


def sweep(f0: float, f1: float, dur: float, tau: float):
    """Sine gliding f0 -> f1, decaying. The weight under the slam."""
    n = seconds(dur)
    tt = np.arange(n) / SR
    f = f0 + (f1 - f0) * np.minimum(tt / dur, 1.0)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-tt / tau)


def mix(*parts):
    """parts: (signal, offset_seconds, gain). Sums into one buffer."""
    end = max(seconds(off) + len(sig) for sig, off, _ in parts)
    out = np.zeros(end)
    for sig, off, gain in parts:
        i = seconds(off)
        out[i:i + len(sig)] += sig * gain
    return out


def finish(x, peak_db: float = -3.0, fade: float = 0.012):
    peak = np.max(np.abs(x))
    if peak > 0:
        x = x * (10 ** (peak_db / 20) / peak)
    n = min(seconds(fade), len(x))
    x[-n:] *= np.linspace(1.0, 0.0, n)
    return x


# --- the wooden family: real stick hits, sliced and pitched ---------------------

def load_sticks():
    if not os.path.exists(STICKS):
        return None
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", STICKS, "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    x = np.frombuffer(raw, np.float32).astype(np.float64)
    return biquad(x, "hp", 150)  # the recording carries a little room rumble


def wood_hit(sticks, at: float, pitch: float = 1.0, dur: float = 0.22,
             tau: float = 0.07):
    """One knock: a hit sliced at `at` seconds, resampled by `pitch`, gated so the
    room between hits does not come along."""
    if sticks is None:
        core = (damped_sine(760 * pitch, dur, tau * 0.8)
                + 0.4 * damped_sine(1930 * pitch, dur, tau * 0.4))
        attack = env(biquad(noise(0.004), "hp", 2000), attack=0.0002, tau=0.004)
        return mix((core, 0, 0.8), (attack, 0, 0.5))
    i = seconds(at)
    take = seconds(dur / min(pitch, 1.0) + 0.05)
    seg = sticks[i:i + take]
    if pitch != 1.0:
        n_out = int(len(seg) / pitch)
        seg = np.interp(np.arange(n_out) * pitch, np.arange(len(seg)), seg)
    tt = np.arange(len(seg)) / SR
    seg = seg * np.exp(-tt / tau)
    seg[:seconds(0.0005)] *= np.linspace(0.0, 1.0, seconds(0.0005))
    return seg[:seconds(dur)]


# Onsets of clean hits in the sticks recording, found by envelope threshold.
HIT_QUIET, HIT_MID, HIT_A, HIT_B, HIT_C = 3.963, 5.106, 6.516, 7.119, 7.372


# --- card foley building blocks -------------------------------------------------

def slap(bright: float = 1800, dur: float = 0.14, thump: float = 0.5):
    """A card landing on felt: band-passed crack over a low-passed body."""
    crack = env(biquad(noise(0.05), "bp", bright, 0.9), attack=0.0008, tau=0.016)
    body = env(biquad(noise(0.09), "lp", 500), attack=0.001, tau=0.028)
    knock = damped_sine(190, 0.09, 0.02)
    return mix((crack, 0, 1.0), (body, 0, thump), (knock, 0.001, 0.25 * thump)
               )[:seconds(dur)]


def slide(dur: float = 0.12, hp: float = 1400):
    """A card dragged off the deck: shaped hiss, amplitude-modulated like texture."""
    x = biquad(noise(dur), "hp", hp)
    tt = np.arange(len(x)) / SR
    shape = np.sin(np.pi * np.minimum(tt / dur, 1.0)) ** 1.5
    texture = 1 + 0.35 * np.sin(2 * np.pi * 105 * tt)
    return x * shape * texture


def tick(freq: float = 3000):
    """One card of a riffle."""
    return env(biquad(noise(0.006), "bp", freq, 1.5), attack=0.0003, tau=0.0025)


def mallet(freq: float, dur: float = 0.9, tau: float = 0.22):
    """Soft wooden bar — the win chime that is not a fanfare."""
    x = (damped_sine(freq, dur, tau)
         + 0.35 * damped_sine(freq * 3.98, dur, tau * 0.4)
         + 0.15 * damped_sine(freq * 9.9, dur, tau * 0.18))
    attack = env(biquad(noise(0.004), "bp", freq * 6, 2), attack=0.0002, tau=0.003)
    return mix((x, 0, 1.0), (attack, 0, 0.18))


# --- the fifteen cues -----------------------------------------------------------

def build(sticks):
    cues = {}

    # play: heard 40-80 times a round; a dry slap and nothing else.
    cues["play"] = slap()

    # action: the same slap with a flick after it — something happened, no alarm.
    cues["action"] = mix(
        (slap(bright=2400, dur=0.13), 0, 1.0),
        (env(biquad(noise(0.03), "bp", 3200, 1.2), tau=0.008), 0.045, 0.45),
        (damped_sine(700, 0.12, 0.04), 0.002, 0.3),
    )[:seconds(0.2)]

    # wild: the table changes colour — air moving high to low, started by a slap.
    dur = 0.42
    hi = biquad(noise(dur), "bp", 2800, 1.2)
    lo = biquad(noise(dur), "bp", 700, 1.0)
    tt = np.arange(seconds(dur)) / SR
    swirl = hi * np.exp(-tt / 0.09) + lo * (1 - np.exp(-tt / 0.07)) * np.exp(-tt / 0.16)
    cues["wild"] = mix((slap(dur=0.1, thump=0.3), 0, 0.7), (swirl, 0.01, 1.0))

    # slam: the +4. The only loud thing in the game; weight, not an explosion.
    cues["slam"] = mix(
        (env(biquad(noise(0.02), "hp", 2500), attack=0.0004, tau=0.006), 0, 0.4),
        (env(biquad(noise(0.12), "bp", 900, 0.8), attack=0.001, tau=0.05), 0, 0.7),
        (sweep(130, 55, 0.35, 0.18), 0.002, 1.0),
        (damped_sine(82, 0.7, 0.22), 0.004, 0.6),
    )[:seconds(0.75)]

    # draw: the most frequent "nothing happened" — a quiet pull off the deck.
    cues["draw"] = slide(dur=0.13, hp=1500)

    # penalty: a pot falling on someone — four slaps stepping down, then a thud.
    cues["penalty"] = mix(
        (slap(bright=2200, dur=0.09, thump=0.3), 0.0, 0.7),
        (slap(bright=1600, dur=0.09, thump=0.45), 0.09, 0.8),
        (slap(bright=1200, dur=0.1, thump=0.6), 0.17, 0.9),
        (slap(bright=950, dur=0.12, thump=0.8), 0.24, 1.0),
        (sweep(150, 70, 0.3, 0.12), 0.24, 0.8),
    )[:seconds(0.56)]

    # uno: two knocks rising — a call across the table, no voice.
    cues["uno"] = mix(
        (wood_hit(sticks, HIT_A, 1.0), 0.0, 1.0),
        (wood_hit(sticks, HIT_C, 1.26), 0.14, 1.0),
        (damped_sine(1320, 0.25, 0.09), 0.145, 0.12),
    )[:seconds(0.45)]

    # caught: two knocks falling, with a low landing — got you.
    cues["caught"] = mix(
        (wood_hit(sticks, HIT_B, 1.05), 0.0, 1.0),
        (wood_hit(sticks, HIT_A, 0.78), 0.13, 1.0),
        (damped_sine(180, 0.2, 0.06), 0.135, 0.35),
    )[:seconds(0.45)]

    # turn: one soft knock — your move, not an alarm clock.
    cues["turn"] = mix(
        (wood_hit(sticks, HIT_MID, 0.95, dur=0.2, tau=0.06), 0, 1.0),
        (damped_sine(320, 0.15, 0.06), 0.002, 0.2),
    )[:seconds(0.22)]

    # reject: a dull "no" — low and dry, nothing like an OS error.
    cues["reject"] = mix(
        (damped_sine(170, 0.15, 0.05), 0, 1.0),
        (env(biquad(noise(0.06), "lp", 400), attack=0.001, tau=0.03), 0, 0.5),
    )[:seconds(0.15)]

    # shuffle: two riffle runs and a squaring tap, under the one-second animation.
    parts = []
    at = 0.0
    for run, count in enumerate((17, 21)):
        step = 0.024
        for i in range(count):
            parts.append((tick(2600 + rng.uniform(-500, 700)), at, 0.5 + 0.5 * rng.random()))
            at += step
            step = max(0.009, step * 0.93)
        at += 0.06
    parts.append((slap(bright=1400, dur=0.1, thump=0.4), at, 0.8))
    cues["shuffle"] = mix(*parts)[:seconds(0.85)]

    # deal: cards going around the table, then a settling tap.
    parts = []
    for i in range(6):
        parts.append((slide(dur=0.09, hp=1400 + 400 * (i % 2)), 0.12 * i, 0.75 + 0.05 * i))
    parts.append((slap(bright=1300, dur=0.1, thump=0.4), 0.74, 0.7))
    cues["deal"] = mix(*parts)[:seconds(0.85)]

    # win: three warm wooden notes going up — an ending, not a triumph.
    cues["win"] = mix(
        (mallet(262), 0.0, 0.8),
        (mallet(330), 0.18, 0.85),
        (mallet(392, dur=1.0, tau=0.28), 0.36, 1.0),
        (env(biquad(noise(0.5), "lp", 800), attack=0.05, tau=0.2), 0.0, 0.12),
    )[:seconds(1.25)]

    # seat: a chair pulled in — a short scrape and a low knock.
    scrape = biquad(noise(0.09), "bp", 550, 1.2)
    tt = np.arange(len(scrape)) / SR
    scrape *= np.sin(np.pi * np.minimum(tt / 0.09, 1.0))
    cues["seat"] = mix(
        (scrape, 0.0, 0.5),
        (wood_hit(sticks, HIT_A, 0.62, dur=0.18, tau=0.06), 0.06, 1.0),
    )[:seconds(0.24)]

    # press: barely a sound at all — the landing's main button.
    cues["press"] = wood_hit(sticks, HIT_QUIET, 1.6, dur=0.08, tau=0.02)

    return cues


BUDGET = {  # seconds, from the spec's table
    "play": 0.18, "action": 0.25, "wild": 0.5, "slam": 0.9, "draw": 0.2,
    "penalty": 0.7, "uno": 0.6, "caught": 0.6, "turn": 0.3, "reject": 0.2,
    "shuffle": 0.9, "deal": 0.9, "win": 1.5, "seat": 0.3, "press": 0.12,
}


def save(name, x):
    raw = x.astype(np.float32).tobytes()
    targets = (
        (os.path.join(OUT, f"{name}.m4a"),
         ["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart"]),
        (os.path.join(PREVIEW, f"{name}.wav"), ["-c:a", "pcm_s16le"]),
    )
    for path, codec in targets:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-f", "f32le", "-ar", str(SR),
             "-ac", "1", "-i", "-", *codec, "-y", path],
            input=raw, check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    sticks = load_sticks()
    if sticks is None:
        print("note: Logic sticks sample not found; wooden cues fall back to synthesis")
    cues = build(sticks)
    total = 0
    for name, x in sorted(cues.items()):
        x = finish(x)
        over = len(x) / SR - BUDGET[name]
        assert over <= 0.001, f"{name} is {over * 1000:.0f} ms over its budget"
        assert np.max(np.abs(x[:seconds(0.005)])) > 0.01, f"{name} starts silent"
        save(name, x)
        size = os.path.getsize(os.path.join(OUT, f"{name}.m4a"))
        total += size
        print(f"  {name:8s} {len(x) / SR * 1000:6.0f} ms {size:6d} B")
    print(f"  total    {total} B of 102400 allowed")
    assert total <= 102400, "the set is over the spec's 100 KB budget"


if __name__ == "__main__":
    main()
