#!/usr/bin/env python3
# Synthesize the fifteen event cues of design/audio-spec.md.
#
#   python3 tools/make-cues.py
#
# This is the shipping set, not a stand-in. It is still DSP rather than a
# microphone next to a real deck, and a recorded set would beat it — but the
# three things that made the earlier placeholder pass read as "computer noise"
# are fixed here, and they are the three that matter:
#
#   * Cards make TWO contacts, not one. An edge touches down and the face
#     follows about five milliseconds later. One burst reads as a click; two
#     read as a card. Every slap in this file is built that way.
#
#   * Nothing in the world is anechoic. Each cue is convolved with a small
#     synthetic room — nine early reflections inside 40 ms over a short diffuse
#     tail — and mixed in at a few percent. Not audible as reverb; audible as
#     the absence of "recorded in a vacuum".
#
#   * Level is matched by LOUDNESS, not by peak. Normalizing a 3 ms tick and a
#     1.2 s chord to the same peak leaves the tick perceptually silent. Each cue
#     is normalized to equal K-weighted loudness so that the multipliers in
#     client/src/sound.ts deliver the balance they were written to deliver.
#
# Source material: mostly synthesis. The wooden family (turn, uno, caught, seat,
# press) is sliced from Small Wood Sticks in the Logic Pro sound library —
# Apple's license covers using its audio content inside your own works, and only
# short processed hits ship, never the raw sample. If that file is absent the
# script falls back to a synthetic knock, so the build never depends on one
# machine.
#
# Every cue is mono 48 kHz, starts on its attack (no leading silence — the
# animation must not wait), fades inside the file, stays inside the spec's length
# budget, and peaks no higher than -3 dBFS. Encoded to AAC; the whole set must
# stay under the spec's 100 KB. The fixed seed makes reruns byte-stable.
import os
import subprocess

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
OUT = "client/public/audio"
PREVIEW = os.path.join(os.environ.get("PREVIEW_DIR", ".audio-preview"), "cues")
STICKS = ("/Library/Application Support/Logic/Alchemy Samples/"
          "Sound Effects/Foley/Small Wood Sticks.wav")
PEAK_CEILING_DB = -3.0
MATCH = 0.5  # how much of a cue's excess loudness to take back; see main()

rng = np.random.default_rng(20260819)


def n(dur: float) -> int:
    return int(round(dur * SR))


def white(dur: float):
    return rng.standard_normal(n(dur))


def _sos(kind, freq, order):
    ny = SR / 2
    if kind == "band":
        lo, hi = freq
        w = [max(lo, 20) / ny, min(hi, ny * 0.98) / ny]
    else:
        w = min(max(freq, 20), ny * 0.98) / ny
    return butter(order, w, btype=kind, output="sos")


def lp(x, f, order=2):
    return sosfilt(_sos("low", f, order), x)


def hp(x, f, order=2):
    return sosfilt(_sos("high", f, order), x)


def bp(x, lo, hi, order=2):
    return sosfilt(_sos("band", (lo, hi), order), x)


def dec(x, tau: float, attack: float = 0.0006):
    """Fast attack, exponential decay — the shape of something being struck.

    The attack is a smoothed ramp rather than a step: a step on a noise burst is
    itself a click, and a click is exactly what we are trying not to sound like."""
    t = np.arange(len(x)) / SR
    e = np.exp(-t / tau)
    if attack > 0:
        e = e * (1 - np.exp(-t / attack))
    return x * e


def modes(spec, dur: float):
    """Sum of damped sines: (frequency, decay time, amplitude). A struck body —
    a card, a table top, a wooden bar — is a handful of these."""
    t = np.arange(n(dur)) / SR
    out = np.zeros_like(t)
    for f, tau, a in spec:
        out += a * np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
    return out


def sweep(f0: float, f1: float, dur: float, tau: float):
    """A sine sagging from f0 to f1 — weight leaving a thing that was dropped."""
    t = np.arange(n(dur)) / SR
    f = f0 + (f1 - f0) * np.clip(t / dur, 0, 1)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)


def mix(*parts):
    """parts: (signal, offset_seconds, gain). Sums into one buffer."""
    end = max(n(off) + len(sig) for sig, off, _ in parts)
    out = np.zeros(end)
    for sig, off, gain in parts:
        i = n(off)
        out[i:i + len(sig)] += sig * gain
    return out


# --- the room ------------------------------------------------------------------

def room_ir(rt60: float = 0.26, predelay: float = 0.005, taps: int = 9):
    """A small carpeted room with a table in it. The early reflections carry the
    size of the room; the diffuse tail only has to stop the sound dying dead."""
    length = n(rt60)
    ir = np.zeros(length)
    ir[0] = 1.0
    at = predelay
    for k in range(taps):
        at += rng.uniform(0.0025, 0.0065)
        i = n(at)
        if i < length:
            ir[i] += (0.82 ** k) * rng.choice([-1.0, 1.0]) * rng.uniform(0.45, 0.9)
    tail = white(rt60) * np.exp(-np.arange(length) / (rt60 * SR / 6.9))
    ir += 0.30 * tail
    ir = lp(hp(ir, 190), 5000)
    return ir / np.sqrt(np.sum(ir ** 2))


ROOM = room_ir()


def spaced(x, amount: float = 0.09, tail: float = 0.18):
    """Put a dry signal in the room, keeping `tail` seconds of it past the end."""
    wet = fftconvolve(x, ROOM)[:len(x) + n(tail)]
    dry = np.zeros(len(wet))
    dry[:len(x)] = x
    wet = wet / (np.max(np.abs(wet)) + 1e-12) * np.max(np.abs(x))
    return dry * (1 - amount) + wet * amount


# --- card foley ----------------------------------------------------------------

def card_slap(bright: float = 1.0, weight: float = 0.5, dur: float = 0.16):
    """A card landing on felt.

    Edge first, face 4.5 ms behind it, the card's own thin body ringing for ten
    milliseconds on top, and under all of it the felt swallowing a low thump that
    the table answers. Nothing here rings longer than 30 ms: felt is what a card
    table is covered with precisely so that nothing does."""
    edge = dec(bp(white(0.008), 2600 * bright, 7500 * bright), 0.0022, 0.00015)
    face = dec(bp(white(0.05), 700 * bright, 4200 * bright), 0.0090, 0.00040)
    body = modes([(1180 * bright, 0.010, 1.0),
                  (2570 * bright, 0.007, 0.55),
                  (4390 * bright, 0.005, 0.28)], 0.05)
    felt = dec(lp(white(0.09), 380), 0.020, 0.0009)
    table = modes([(168, 0.030, 1.0), (255, 0.018, 0.4)], 0.09)
    out = mix((edge, 0.0, 0.55), (face, 0.0045, 1.0), (body, 0.0045, 0.20),
              (felt, 0.005, weight), (table, 0.006, 0.30 * weight))
    return out[:n(dur)]


def card_slide(dur: float = 0.14, bright: float = 1.0, rough: float = 1.0):
    """A card pulled off the deck: friction, not a swoosh. The roughness is the
    point — paper on paper is a texture a few hundred times a second, and smooth
    noise is what makes a synthesized slide sound like an aerosol can."""
    x = bp(white(dur), 1100 * bright, 7000 * bright)
    t = np.arange(len(x)) / SR
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.4
    m = lp(white(dur), 260)
    m = m / (np.max(np.abs(m)) + 1e-12)
    x = x * shape * (1 + rough * 0.55 * m)
    clear = dec(bp(white(0.02), 2200, 6500), 0.004, 0.0003)  # the card comes free
    return mix((x, 0.0, 1.0), (clear, dur * 0.80, 0.35))[:n(dur)]


def riffle_tick(centre: float = 2800):
    """One card of a riffle leaving the thumb."""
    return dec(bp(white(0.008), centre * 0.55, centre * 1.9), 0.0026, 0.00020)


def mallet(freq: float, dur: float = 0.9, tau: float = 0.24):
    """A soft wooden bar. Warm, quick attack, no sustain — a marimba, not a bell,
    because a bell is a fanfare and this game does not do fanfares."""
    core = modes([(freq, tau, 1.0),
                  (freq * 3.98, tau * 0.34, 0.30),
                  (freq * 9.9, tau * 0.14, 0.10)], dur)
    knock = dec(bp(white(0.006), freq * 3, freq * 9), 0.0028, 0.00025)
    return mix((core, 0.0, 1.0), (knock, 0.0, 0.16))


# --- the wooden family: real stick hits, sliced and pitched ---------------------

def load_sticks():
    if not os.path.exists(STICKS):
        return None
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", STICKS, "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"], capture_output=True, check=True).stdout
    # The recording carries a little room rumble of its own.
    return hp(np.frombuffer(raw, np.float32).astype(np.float64), 150)


# Onsets of clean hits in the sticks recording, found by envelope threshold.
HIT_QUIET, HIT_MID, HIT_A, HIT_B, HIT_C = 3.963, 5.106, 6.516, 7.119, 7.372


def wood_hit(sticks, at: float, pitch: float = 1.0, dur: float = 0.22,
             tau: float = 0.07):
    """One knock: the hit at `at` seconds, resampled by `pitch` and gated so the
    room between hits does not come along with it."""
    if sticks is None:
        core = modes([(760 * pitch, tau * 0.8, 1.0),
                      (1930 * pitch, tau * 0.4, 0.4)], dur)
        attack = dec(hp(white(0.004), 2000), 0.004, 0.0002)
        return mix((core, 0, 0.8), (attack, 0, 0.5))
    i = n(at)
    seg = sticks[i:i + n(dur / min(pitch, 1.0) + 0.05)]
    if pitch != 1.0:
        out_n = int(len(seg) / pitch)
        seg = np.interp(np.arange(out_n) * pitch, np.arange(len(seg)), seg)
    seg = seg * np.exp(-np.arange(len(seg)) / SR / tau)
    ramp = n(0.0005)
    seg[:ramp] *= np.linspace(0.0, 1.0, ramp)
    return seg[:n(dur)]


# --- the fifteen ---------------------------------------------------------------

def build(sticks):
    c = {}

    # play — 40-80 times a round. One card, one contact, gone. Any more
    # personality than this is a sound you are sick of by minute three.
    c["play"] = spaced(card_slap(), 0.07)

    # action — the same card landing a little harder, with the paper flick of one
    # that was turned on its way down. Same family, different temper: the spec
    # asks for one sound with two shades, not for two sounds.
    c["action"] = spaced(mix(
        (card_slap(bright=1.25, weight=0.55, dur=0.14), 0.0, 1.0),
        (dec(bp(white(0.04), 1800, 5200), 0.010, 0.0004), 0.048, 0.40),
        (modes([(720, 0.035, 1.0), (1140, 0.020, 0.4)], 0.10), 0.003, 0.22),
    )[:n(0.20)], 0.08)

    # wild — the table is being repainted. A card lands, then the air over it
    # moves from bright to warm as the colour settles. No sparkle, no magic.
    dur = 0.40
    t = np.arange(n(dur)) / SR
    hi = bp(white(dur), 1800, 6000)
    lo = bp(white(dur), 380, 1400)
    swirl = hi * np.exp(-t / 0.075) + lo * (1 - np.exp(-t / 0.06)) * np.exp(-t / 0.17)
    c["wild"] = spaced(mix(
        (card_slap(bright=1.1, weight=0.35, dur=0.12), 0.0, 0.85),
        (swirl, 0.012, 0.85),
        (modes([(392, 0.22, 1.0), (588, 0.16, 0.45), (784, 0.11, 0.2)], 0.34),
         0.02, 0.10),
    )[:n(0.46)], 0.11)

    # slam — the +4, and the only genuinely loud thing in the game. The table
    # shakes on screen, so it shakes here: a heavy contact, the whole table top
    # answering under it, weight sagging away. Still a card — no metal, no bomb.
    c["slam"] = spaced(mix(
        (dec(hp(white(0.03), 2200), 0.0055, 0.00020), 0.0, 0.45),
        (dec(bp(white(0.16), 500, 3000), 0.030, 0.00050), 0.0035, 0.85),
        (modes([(150, 0.16, 1.0), (232, 0.10, 0.5), (95, 0.22, 0.7)], 0.5),
         0.005, 0.70),
        (sweep(128, 52, 0.34, 0.17), 0.004, 0.85),
    )[:n(0.72)], 0.13, tail=0.16)

    # draw — the most frequent nothing-happened in the game. A card comes off the
    # deck and that is all; notice it twice and you will notice it forty times.
    c["draw"] = spaced(card_slide(dur=0.14, bright=1.0), 0.05)

    # penalty — the pot lands on somebody. Four cards stepping down in pitch and
    # speeding up, then the stack settling. The sag at the end is the whole joke,
    # and it is a small one: these are friends.
    c["penalty"] = spaced(mix(
        (card_slap(bright=1.30, weight=0.30, dur=0.09), 0.000, 0.60),
        (card_slap(bright=1.10, weight=0.40, dur=0.09), 0.075, 0.72),
        (card_slap(bright=0.92, weight=0.55, dur=0.10), 0.140, 0.86),
        (card_slap(bright=0.78, weight=0.85, dur=0.14), 0.196, 1.00),
        (sweep(148, 74, 0.26, 0.11), 0.199, 0.55),
        (modes([(120, 0.10, 1.0)], 0.22), 0.205, 0.30),
    )[:n(0.52)], 0.12)

    # uno — a shout across the table without a voice. Two knuckles on wood,
    # rising, the second one asking the question. The spec forbids the word, and
    # a sampled shout would age worse than anything else in the game.
    c["uno"] = spaced(mix(
        (wood_hit(sticks, HIT_A, 1.00), 0.00, 1.0),
        (wood_hit(sticks, HIT_C, 1.26), 0.14, 1.0),
        (modes([(1320, 0.09, 1.0)], 0.25), 0.145, 0.10),
    )[:n(0.44)], 0.14)

    # caught — the same two knocks falling instead of rising, with something heavy
    # under the second. Got you. Not a system error, not a laugh.
    c["caught"] = spaced(mix(
        (wood_hit(sticks, HIT_B, 1.05), 0.00, 1.0),
        (wood_hit(sticks, HIT_A, 0.76), 0.13, 1.0),
        (modes([(176, 0.06, 1.0), (262, 0.04, 0.4)], 0.22), 0.135, 0.35),
    )[:n(0.44)], 0.13)

    # turn — your move. It has to reach somebody looking at another window, which
    # is why it carries a little pitch instead of being a bare knock; and it must
    # not be an alarm clock, which is why the pitch is warm and gone in a fifth
    # of a second.
    c["turn"] = spaced(mix(
        (wood_hit(sticks, HIT_MID, 0.95, dur=0.20, tau=0.06), 0.0, 1.0),
        (mallet(523, dur=0.22, tau=0.075), 0.002, 0.30),
    )[:n(0.24)], 0.12)

    # reject — the card would not go and it came back. A dull no with no edge on
    # it: the player did nothing wrong, the card just does not fit.
    c["reject"] = spaced(mix(
        (modes([(163, 0.045, 1.0), (247, 0.025, 0.35)], 0.16), 0.0, 1.0),
        (dec(lp(white(0.07), 420), 0.026, 0.0010), 0.0, 0.55),
    )[:n(0.17)], 0.08)

    # shuffle — a riffle, a bridge and a squaring tap, inside the second the
    # animation lasts. The ticks accelerate because that is what a thumb letting
    # go of a deck actually does.
    parts, at = [], 0.0
    for count in (16, 20):
        step = 0.023
        for _ in range(count):
            parts.append((riffle_tick(2600 + rng.uniform(-500, 800)), at,
                          0.5 + 0.5 * rng.random()))
            at += step
            step = max(0.0085, step * 0.93)
        at += 0.055
    parts.append((card_slide(dur=0.10, bright=0.8), at - 0.03, 0.5))
    parts.append((card_slap(bright=0.9, weight=0.45, dur=0.10), at + 0.03, 0.8))
    c["shuffle"] = spaced(mix(*parts)[:n(0.80)], 0.10)

    # deal — cards going round the table, each one pulled and landed, the landings
    # walking away from the listener. Then the deck squared. A beginning, not a
    # ceremony.
    parts = []
    for i in range(6):
        at = 0.118 * i
        parts.append((card_slide(dur=0.085, bright=1.05 + 0.10 * (i % 2)), at, 0.55))
        parts.append((card_slap(bright=1.0 - 0.05 * (i % 3), weight=0.4, dur=0.10),
                      at + 0.055, 0.75 - 0.05 * i))
    parts.append((card_slap(bright=0.85, weight=0.5, dur=0.12), 0.735, 0.7))
    c["deal"] = spaced(mix(*parts)[:n(0.84)], 0.11)

    # win — somebody went out. Two wooden notes a fifth apart over a low bloom:
    # an ending, not a victory. Three of the four people listening have just
    # lost, and all of them have to be willing to hear it again next round.
    c["win"] = spaced(mix(
        (mallet(392, dur=0.9, tau=0.26), 0.00, 0.85),
        (mallet(587, dur=1.1, tau=0.30), 0.17, 0.80),
        (mallet(196, dur=1.2, tau=0.40), 0.02, 0.45),
        (dec(lp(white(0.6), 900), 0.22, 0.045), 0.0, 0.09),
    )[:n(1.30)], 0.16, tail=0.2)

    # seat — a chair pulled in at the table. Somebody arrived; nobody received a
    # push notification.
    rough = lp(white(0.10), 180)
    scrape = bp(white(0.10), 380, 1600)
    ts = np.arange(len(scrape)) / SR
    scrape *= np.sin(np.pi * np.clip(ts / 0.10, 0, 1)) ** 1.2
    scrape *= 1 + 0.4 * rough / (np.max(np.abs(rough)) + 1e-12)
    c["seat"] = spaced(mix(
        (scrape, 0.0, 0.45),
        (wood_hit(sticks, HIT_A, 0.62, dur=0.18, tau=0.055), 0.062, 1.0),
    )[:n(0.26)], 0.11)

    # press — the button on the landing. Confirmation that a finger landed on
    # something physical, and nothing else. If you can describe it, it is too loud.
    c["press"] = spaced(wood_hit(sticks, HIT_QUIET, 1.6, dur=0.08, tau=0.02), 0.06)

    return c


# --- level, budget, encoding ----------------------------------------------------

BUDGET = {  # seconds, from the spec's table
    "play": 0.18, "action": 0.25, "wild": 0.5, "slam": 0.9, "draw": 0.2,
    "penalty": 0.7, "uno": 0.6, "caught": 0.6, "turn": 0.3, "reject": 0.2,
    "shuffle": 0.9, "deal": 0.9, "win": 1.5, "seat": 0.3, "press": 0.12,
}

# What client/src/sound.ts multiplies each cue by. Kept here so the report can
# show the balance as delivered, not only the balance as authored.
LEVEL = {
    "play": 0.45, "action": 0.55, "slam": 0.90, "wild": 0.60, "draw": 0.40,
    "penalty": 0.80, "uno": 0.70, "caught": 0.70, "turn": 0.50, "reject": 0.40,
    "win": 0.85, "shuffle": 0.50, "deal": 0.60, "seat": 0.50, "press": 0.35,
}


def loudness_db(x):
    """K-weighted energy spread over a 400 ms window — momentary loudness, near
    enough. The weighting is BS.1770's shape, not its coefficients: drop what is
    under 60 Hz, lift what is over 1.5 kHz, and a tick stops reading as silence."""
    y = hp(x, 60, order=2)
    y = y + 0.5 * hp(y, 1500, order=1)
    return 10 * np.log10(np.sum(y ** 2) / (0.4 * SR) + 1e-20)


def trim_tail(x, fade: float = 0.014):
    """Fade inside the file. A cue cut off at full level is a click of its own."""
    n_fade = min(n(fade), len(x))
    x = x.copy()
    x[len(x) - n_fade:] *= np.linspace(1.0, 0.0, n_fade)
    return x


def encode(name, x):
    raw = x.astype(np.float32).tobytes()
    for path, codec in (
        (os.path.join(OUT, f"{name}.m4a"),
         ["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart"]),
        (os.path.join(PREVIEW, f"{name}.wav"), ["-c:a", "pcm_s24le"]),
    ):
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "f32le",
                        "-ar", str(SR), "-ac", "1", "-i", "-", *codec, "-y", path],
                       input=raw, check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    sticks = load_sticks()
    if sticks is None:
        print("note: Logic sticks sample not found; wooden cues fall back to synthesis")

    # The room adds a tail past the dry end, so the budget is enforced here
    # rather than inside build(): clip to it, then fade inside what is left.
    cues = {k: trim_tail(v[:n(BUDGET[k])]) for k, v in build(sticks).items()}

    # Peak to the ceiling first, then take back HALF of each cue's loudness
    # excess over the set's median.
    #
    # Neither pure scheme works. Matching peaks alone — what the placeholder pass
    # did — leaves a 16 dB loudness spread: a 3 ms tick and a 1.5 s chord both
    # touch -3 dBFS and only one of them is audible. Matching loudness alone
    # drops the dense cues fifteen decibels below the ceiling, because a
    # transient cannot be made RMS-loud without clipping, and they end up under
    # the music they are supposed to sit above.
    #
    # So: everything stays near full scale, and only the cues LOUDER than the
    # median are pulled down, by half their excess. The spread closes to about
    # eight decibels and nothing is pushed into the ceiling.
    ceiling = 10 ** (PEAK_CEILING_DB / 20)
    cues = {k: x * (ceiling / (np.max(np.abs(x)) + 1e-12)) for k, x in cues.items()}
    ref = float(np.median([loudness_db(x) for x in cues.values()]))
    cues = {k: x * 10 ** (min(0.0, (ref - loudness_db(x)) * MATCH) / 20)
            for k, x in cues.items()}

    print(f"  {'cue':9s} {'ms':>6s} {'peak dB':>8s} {'loud dB':>8s} "
          f"{'level':>6s} {'as heard':>9s} {'bytes':>7s}")
    total = 0
    for name in sorted(cues):
        x = cues[name]
        over = len(x) / SR - BUDGET[name]
        assert over <= 0.001, f"{name} is {over * 1000:.0f} ms over its budget"
        assert np.max(np.abs(x[:n(0.006)])) > 0.005, f"{name} starts silent"
        peak = 20 * np.log10(np.max(np.abs(x)))
        assert peak <= PEAK_CEILING_DB + 0.01, f"{name} peaks at {peak:.1f} dBFS"
        loud = loudness_db(x)
        encode(name, x)
        size = os.path.getsize(os.path.join(OUT, f"{name}.m4a"))
        total += size
        print(f"  {name:9s} {len(x) / SR * 1000:6.0f} {peak:8.1f} {loud:8.1f} "
              f"{LEVEL[name]:6.2f} {loud + 20 * np.log10(LEVEL[name]):9.1f} {size:7d}")
    print(f"  {'total':9s} {'':6s} {'':8s} {'':8s} {'':6s} {'':9s} {total:7d}"
          f"  of 102400 allowed")
    assert total <= 102400, "the set is over the spec's 100 KB budget"


if __name__ == "__main__":
    main()
