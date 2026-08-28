// Sub-project C: the audio layer.
//
// Two very different jobs, and now a switch each — see `SoundSettings`.
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
const SFX_KEY = 'ochre:sfx';
const MUSIC_KEY = 'ochre:music';
// The single switch these two replaced. It only ever exists for a browser that
// pressed it, so its presence — not its absence — is the visitor's opinion.
const LEGACY_MUTE_KEY = 'ochre:muted';
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

/** The two halves of the layer, switched apart. They used to share one flag, which
 *  made "I want the cards to click but not the loop" unsayable. */
export interface SoundSettings { sfx: boolean; music: boolean }
export type Channel = keyof SoundSettings;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: HTMLAudioElement | null = null;
const buffers = new Map<Cue, AudioBuffer | null>(); // null = asked for, not available
const listeners = new Set<(s: SoundSettings) => void>();

const read = (key: string): 'on' | 'off' | null => {
  try {
    const v = localStorage.getItem(key);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
};

/** Sound is on until the visitor says otherwise. It used to be off until they said
 *  otherwise, and the only switch lived on the landing — so a guest who opened an
 *  invite link went through the whole game in silence with nothing to press. The
 *  browser's own gesture gate, not a default, is what keeps the page quiet on load. */
function initial(): SoundSettings {
  const legacy = read(LEGACY_MUTE_KEY);
  const fallback = legacy === null ? true : legacy === 'off';
  const pick = (key: string): boolean => read(key) === null ? fallback : read(key) === 'on';
  return { sfx: pick(SFX_KEY), music: pick(MUSIC_KEY) };
}

let settings: SoundSettings | null = null;

export function soundSettings(): SoundSettings {
  if (!settings) settings = initial();
  return settings;
}

export function setChannel(ch: Channel, on: boolean): void {
  settings = { ...soundSettings(), [ch]: on };
  try {
    localStorage.setItem(ch === 'sfx' ? SFX_KEY : MUSIC_KEY, on ? 'on' : 'off');
  } catch {
    // A browser refusing storage still gets sound this session; it just forgets.
  }
  if (ch === 'sfx') {
    if (master && ctx) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02);
    if (on) void resume();
  } else if (on) {
    void startMusic();
  } else {
    stopMusic();
  }
  for (const fn of listeners) fn(settings);
}

/** Subscribe a control to the settings; returns the unsubscribe. Every copy of the
 *  switch is mounted on a different screen, and they must not drift apart. */
export function onSoundChange(fn: (s: SoundSettings) => void): () => void {
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
    master.gain.value = soundSettings().sfx ? 1 : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  return ctx;
}

/** Called once from the first real gesture anywhere in the app. Before this, every
 *  `cue()` is a no-op — by browser policy, not by choice.
 *
 *  This is also what carries the music through the door. Every way into a room is a
 *  hard navigation (`/r/CODE`, and `/` on the way out), so the module is rebuilt from
 *  scratch each time; the want has to live in storage rather than in a variable, or
 *  the bed plays on the landing and dies at the lobby. */
export function unlockAudio(): void {
  void resume().then(() => { if (soundSettings().music) void startMusic(); });
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
  if (!soundSettings().sfx || !ctx) return;
  void load(name).then((buf) => {
    if (!buf || !ctx || !master || !soundSettings().sfx) return;
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
  if (!soundSettings().music) return;
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
  music?.pause();
}
