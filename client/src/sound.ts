// Sub-project C: the audio layer.
//
// Two very different jobs behind one switch.
//
// Event cues are short, fire often and sometimes overlap — two cards can land inside
// the same animation — so they go through WebAudio: decoded once, held as buffers and
// started with no latency and no instance limit. An <audio> element per cue would add
// a fetch, a decode and a scheduling delay to every card played.
//
// The music is the opposite: one long file nobody should have to hold in memory
// decoded (two and a half minutes of stereo float is ~50 MB), so it stays an <audio>
// element and streams.
//
// Nothing here makes a sound until the visitor has interacted with the page. That is
// not politeness, it is policy: browsers refuse to start an AudioContext otherwise,
// and a page that tries is left holding a suspended context it never resumes.
const MUTE_KEY = 'ochre:muted';
const MUSIC_SRC = '/audio/table.m4a';

/** Every moment that can speak. Names are the file names: `/audio/<cue>.m4a`. */
export type Cue =
  | 'play' | 'action' | 'slam' | 'wild' | 'draw' | 'penalty'
  | 'uno' | 'caught' | 'turn' | 'reject' | 'win' | 'shuffle' | 'deal'
  | 'seat' | 'press';

/** Cue volumes, relative to the master. A card goes down dozens of times a round and
 *  must never tire; the +4 slam happens rarely and is allowed to land. */
const LEVEL: Record<Cue, number> = {
  play: 0.45, action: 0.55, slam: 0.9, wild: 0.6, draw: 0.4, penalty: 0.8,
  uno: 0.7, caught: 0.7, turn: 0.5, reject: 0.4, win: 0.85, shuffle: 0.5,
  deal: 0.6, seat: 0.5, press: 0.35,
};
// Under the cues: it is a room, not a soundtrack. The number is measured, not
// chosen — the loop ships at -20 LUFS (tools/make-music-loop.sh), and 0.2 puts the
// bed a few decibels below even `press`, the quietest thing in the game. It was
// 0.34 while the music was still the -10.8 LUFS master, where the bed came out
// over the top of nearly every cue.
const MUSIC_LEVEL = 0.2;

/** Cues that fire dozens of times a round get a little pitch and level scatter, so
 *  the fortieth card does not land on exactly the same sample as the first. Real
 *  cards never repeat; a buffer always does, and the ear catches it long before it
 *  can say why. Kept small — this is variation, not an effect. */
const SCATTER: Partial<Record<Cue, number>> = { play: 0.05, draw: 0.06, action: 0.04 };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: HTMLAudioElement | null = null;
let musicWanted = false;
const buffers = new Map<Cue, AudioBuffer | null>(); // null = asked for, not available
const listeners = new Set<(muted: boolean) => void>();

/** Muted unless the visitor has said otherwise — silence is the safe default, and the
 *  landing's switch is the only thing that changes it. */
export const isMuted = (): boolean => {
  try {
    return localStorage.getItem(MUTE_KEY) !== 'off';
  } catch {
    return true;
  }
};

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? 'on' : 'off');
  } catch {
    // A browser refusing storage still gets sound this session; it just forgets.
  }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  if (music) music.volume = muted ? 0 : MUSIC_LEVEL;
  if (!muted) void resume();
  for (const fn of listeners) fn(muted);
}

/** Subscribe a control to the mute state; returns the unsubscribe. */
export function onMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function resume(): Promise<AudioContext | null> {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return ctx;
}

/** Called once from the first real gesture anywhere in the app. Before this, every
 *  `cue()` is a no-op — by browser policy, not by choice. */
export function unlockAudio(): void {
  void resume().then(() => { if (musicWanted) void startMusic(); });
}

async function load(name: Cue): Promise<AudioBuffer | null> {
  if (buffers.has(name)) return buffers.get(name) ?? null;
  const c = await resume();
  if (!c) return null;
  try {
    const res = await fetch(`/audio/${name}.m4a`);
    // A cue that has not been recorded yet does not 404: the server hands unknown
    // paths to the single-page app, so a missing sound arrives as HTML with a 200.
    // Check what came back rather than leaving the decoder to choke on a web page.
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio')) {
      throw new Error('not an audio file');
    }
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    buffers.set(name, buf);
    return buf;
  } catch {
    // The cue has not been recorded yet, or this browser cannot decode it. Remember
    // the miss so a card played forty times does not fetch a 404 forty times.
    buffers.set(name, null);
    return null;
  }
}

/** Fire and forget. Silent when muted, before the first gesture, or while a cue's
 *  file is still missing — the table must never wait on, or break for, audio. */
export function cue(name: Cue): void {
  if (isMuted() || !ctx) return;
  void load(name).then((buf) => {
    if (!buf || !ctx || !master || isMuted()) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = LEVEL[name];
    const scatter = SCATTER[name];
    if (scatter) {
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * scatter;
      g.gain.value *= 1 + (Math.random() * 2 - 1) * 0.1;
    }
    src.connect(g).connect(master);
    src.start();
  });
}

export async function startMusic(): Promise<void> {
  musicWanted = true;
  if (isMuted()) return;
  if (!music) {
    music = new Audio(MUSIC_SRC);
    music.loop = true;
    music.preload = 'none';
  }
  music.volume = MUSIC_LEVEL;
  // Autoplay can still be refused; a rejected promise is not an error worth showing.
  await music.play().catch(() => {});
}

export function stopMusic(): void {
  musicWanted = false;
  music?.pause();
}
