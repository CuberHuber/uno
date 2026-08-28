// The sound switch, wherever the player happens to be.
//
// It used to live in the landing header and nowhere else, which meant a guest who
// opened an invite link never rendered the screen that held it. Now every screen
// mounts this, and the copies follow one another through `onSoundChange` rather
// than each keeping a `useState` of its own and drifting.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import {
  cue, musicLevel, onSoundChange, setChannel, setMusicLevel, soundSettings, type Channel,
} from '../sound';

const ROWS: { ch: Channel; name: 'sound.sfx' | 'sound.music'; hint: 'sound.sfxHint' | 'sound.musicHint' }[] = [
  { ch: 'sfx', name: 'sound.sfx', hint: 'sound.sfxHint' },
  { ch: 'music', name: 'sound.music', hint: 'sound.musicHint' },
];

export default function SoundSettings({ className }: { className?: string }) {
  const { t } = useT();
  const [s, setS] = useState(soundSettings);
  const [vol, setVol] = useState(musicLevel);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => onSoundChange(setS), []);

  // A popover over a game board has to be dismissible without hunting for the
  // button again — the board underneath is the thing the player wants back.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const flip = (ch: Channel) => {
    const next = !s[ch];
    setChannel(ch, next);
    // Turning cues back on should prove itself. The click that did it is also the
    // gesture the browser was waiting for, so this is audible on the first press.
    if (ch === 'sfx' && next) cue('press');
  };

  const anyOn = s.sfx || s.music;
  return (
    <div className={`sound-wrap${className ? ` ${className}` : ''}`} ref={wrap}>
      <button type="button" className="btn btn-ghost ghost-pill sound-btn"
        aria-label={t('sound.open')} title={t('sound.open')} aria-expanded={open}
        onClick={() => { cue('press'); setOpen((o) => !o); }}>
        <span aria-hidden="true">{anyOn ? '●' : '○'}</span>
      </button>
      {open && (
        <div className="sound-pop" role="group" aria-label={t('sound.title')}>
          <div className="sound-pop-title">{t('sound.title')}</div>
          {ROWS.map((r) => (
            <button key={r.ch} type="button" className="rulerow sound-row" role="switch"
              aria-checked={s[r.ch]} onClick={() => flip(r.ch)}>
              <span className="rulerow-text">
                <span className="rulerow-name">{t(r.name)}</span>
                <span className="rulerow-desc">{t(r.hint)}</span>
              </span>
              <span className={`rulerow-track${s[r.ch] ? ' rulerow-track-on' : ''}`}>
                <span className="rulerow-knob" />
              </span>
            </button>
          ))}
          {/* The bed's level was a measured constant, right for a quiet room and
              wrong for a loud one. Only the player knows which they are in. */}
          <label className={`sound-vol${s.music ? '' : ' sound-vol-off'}`}>
            <span>{t('sound.musicLevel')}</span>
            <input type="range" min={2} max={100} step={2} value={Math.round(vol * 100)}
              disabled={!s.music} aria-label={t('sound.musicLevel')}
              onChange={(e) => {
                const next = Number(e.target.value) / 100;
                setVol(next);
                setMusicLevel(next);
              }} />
          </label>
        </div>
      )}
    </div>
  );
}
