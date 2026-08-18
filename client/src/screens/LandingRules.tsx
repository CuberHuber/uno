// The landing's "how the game plays" section — six base rules, each with a small
// drawn scene. Port of the Rules of the game section in
// design/Ochre Eights - Landing Page.dc.html.
//
// The scenes are CSS keyframes over plain divs rather than video or GIF: they weigh
// nothing, stay sharp at any size, and can be restyled without re-recording.
// Keyframes and shared pieces live in game.css under the `eo-` prefix.
//
// The prose is NOT written here. It comes from BASICS_CATALOG, the same source the
// in-game rules slide and help read, so the landing cannot drift from the game — and
// it arrives in both languages for free.
import type { CSSProperties, JSX } from 'react';
import { BASICS_CATALOG, type BasicInfo } from '@uno/shared';
import { useT } from '../i18n';

const RED = '#c23b2e', YELLOW = '#e0a020', GREEN = '#66923f', BLUE = '#2e6f8a', WILD = '#6b5f4a';
const INK = { red: '#c23b2e', yellow: '#a37016', green: '#4d7030', blue: '#2e6f8a' };

/** A card face: the suit colour with a cream oval punched out of the middle. */
const face = (suit: string) =>
  `radial-gradient(ellipse 58% 40% at 50% 50%, var(--card-cream) 99%, #0000 100%), ${suit}`;

type S = CSSProperties;
/** One scene beat. `freeze` is where the loop parks under reduced motion — the
 *  frame that shows the rule most clearly, not wherever it happened to stop. */
const anim = (name: string, delay: number, freeze: number): S => ({
  animation: `${name} 6s ease-in-out infinite`,
  animationDelay: `${delay}s`,
  ['--freeze' as string]: `${freeze}s`,
});
const LIFT = 'inset 0 0 0 1.5px rgba(0,0,0,.18), 0 5px 10px rgba(32,30,29,.2)';

/** Three cards cover the same red 7 — by colour, by number, by symbol. */
function SceneMatch() {
  return (
    <>
      <div className="eo-c" style={{ background: face(RED), color: INK.red, boxShadow: LIFT }}>7</div>
      <div data-anim style={{ position: 'absolute', left: '50%', top: '50%', width: 46, height: 60, margin: '-30px 0 0 -23px', borderRadius: 9, border: '2px solid var(--color-accent)', ...anim('eo-hl', 0, -0.4) }} />
      <div className="eo-c" data-anim style={{ background: face(RED), color: INK.red, ['--sx' as string]: '-56px', ...anim('eo-play', 0, -1.1) }}>3</div>
      <div className="eo-c" data-anim style={{ background: face(BLUE), color: INK.blue, ['--sx' as string]: '0px', ...anim('eo-play', 2, -1.1) }}>7</div>
      <div className="eo-c" data-anim style={{ background: face(RED), color: INK.red, fontFamily: 'inherit', ['--sx' as string]: '56px', ...anim('eo-play', 4, -1.1) }}>⊘</div>
    </>
  );
}

/** Skip dims a seat, reverse swings the arrow, draw-two arcs into the next hand. */
function SceneActions() {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 12, display: 'flex', justifyContent: 'center', gap: 16 }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: RED }} />
        <div style={{ position: 'relative' }}>
          <div data-anim style={{ width: 14, height: 14, borderRadius: '50%', background: YELLOW, ...anim('eo-dim', 0, -1.5) }} />
          <div data-anim style={{ position: 'absolute', left: -5, top: 6, width: 24, height: 2, background: 'var(--color-text)', ...anim('eo-strike', 0, -1.5) }} />
        </div>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: GREEN }} />
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: BLUE }} />
      </div>
      <div data-anim style={{ position: 'absolute', left: '50%', bottom: 10, marginLeft: -11, fontSize: 19, color: 'var(--color-neutral-600)', ...anim('eo-flip', 0, -3.5) }}>↻</div>
      <div className="eo-c" data-anim style={{ top: '52%', background: face(YELLOW), color: INK.yellow, fontFamily: 'inherit', fontSize: 16, ['--sx' as string]: '-52px', ...anim('eo-play', 0, -1.1) }}>⊘</div>
      <div className="eo-c" data-anim style={{ top: '52%', background: face(GREEN), color: INK.green, fontFamily: 'inherit', ['--sx' as string]: '0px', ...anim('eo-play', 2, -1.1) }}>⇄</div>
      <div className="eo-c" data-anim style={{ top: '52%', background: face(BLUE), color: INK.blue, fontSize: 13, ['--sx' as string]: '52px', ...anim('eo-play', 4, -1.1) }}>+2</div>
      <div className="eo-back" data-anim style={{ position: 'absolute', left: '50%', top: '46%', width: 22, height: 31, borderRadius: 4, ...anim('eo-arc', 4, -5.3) }} />
      <div className="eo-back" data-anim style={{ position: 'absolute', left: '50%', top: '46%', marginLeft: 6, width: 22, height: 31, borderRadius: 4, ...anim('eo-arc', 4.15, -5.4) }} />
    </>
  );
}

/** A wild lands, four colours fan out, one is chosen, the felt washes to it. */
function SceneWilds() {
  const dots: [string, number, number][] = [[RED, -42, -4], [YELLOW, -14, -12], [GREEN, 14, -12], [BLUE, 42, -4]];
  return (
    <>
      <div data-anim style={{ position: 'absolute', inset: 0, background: BLUE, ...anim('eo-wash', 0, -4.2) }} />
      <div className="eo-c" style={{ top: '56%', background: face(GREEN), color: INK.green, boxShadow: LIFT }}>5</div>
      <div className="eo-c" data-anim style={{ top: '56%', background: WILD, ['--sx' as string]: '-50px', ...anim('eo-play', 0, -1.3) }}>
        <div className="eo-wildface" />
      </div>
      {dots.map(([c, dx, dy]) => {
        const chosen = c === BLUE;
        return (
          <div key={c} data-anim style={{
            position: 'absolute', left: '50%', top: '26%', width: 12, height: 12, marginLeft: -6,
            borderRadius: '50%', background: c,
            boxShadow: chosen ? '0 0 0 3px rgba(46,111,138,.3)' : undefined,
            ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`,
            animation: chosen
              ? 'eo-fan 6s ease-in-out infinite, eo-chosen 6s ease-in-out infinite'
              : 'eo-fan 6s ease-in-out infinite',
            ['--freeze' as string]: chosen ? '-3.4s' : '-2s',
          }} />
        );
      })}
    </>
  );
}

/** Nothing in hand fits, so a card is drawn — played, or kept while the turn passes. */
function SceneDraw() {
  const hand: [keyof typeof INK, string, string, number, string, string][] = [
    ['red', RED, '2', 22, '-7deg', '0s'],
    ['yellow', YELLOW, '6', 38, '0deg', '.08s'],
    ['blue', BLUE, '3', 54, '7deg', '.16s'],
  ];
  return (
    <>
      <div className="eo-c" style={{ top: '38%', background: face(GREEN), color: INK.green, boxShadow: LIFT }}>5</div>
      <div className="eo-back" style={{ position: 'absolute', right: 14, top: '38%', width: 30, height: 42, marginTop: -21, borderRadius: 5, boxShadow: '0 4px 9px rgba(32,30,29,.22)' }} />
      <div className="eo-c" data-anim style={{ top: '38%', background: face(GREEN), color: INK.green, ...anim('eo-slidein', 0, -2.4) }}>9</div>
      <div className="eo-c" data-anim style={{ top: '38%', background: face(BLUE), color: INK.blue, ...anim('eo-tohand', 0, -4.8) }}>4</div>
      {hand.map(([ink, c, v, left, rot, delay]) => (
        <div key={v} className="eo-hand" data-anim style={{
          left: `${left}%`, background: face(c), color: INK[ink],
          ['--rot' as string]: rot,
          animation: `eo-shake 6s ease-in-out infinite ${delay}`,
          ['--freeze' as string]: '-.6s',
        }}>{v}</div>
      ))}
    </>
  );
}

/** The call and the closing window — played once safely, once a beat too late. */
function SceneLastCard() {
  const { t } = useT();
  return (
    <>
      <div data-anim style={{ position: 'absolute', left: '50%', top: '50%', width: 74, height: 74, margin: '-37px 0 0 -37px', borderRadius: '50%', border: '2px dashed var(--color-accent)', borderTopColor: 'transparent', animation: 'eo-close 6s linear infinite', ['--freeze' as string]: '-2.4s' }} />
      {/* The label the table actually shows, read from the same key the game button
          uses — an illustration that named a different button would teach the wrong
          thing, and a hard-coded English one would survive the language switch. */}
      <div className="eo-badge" data-anim style={{ left: '50%', background: 'var(--color-accent)', ...anim('eo-badge', 0, -2) }}>{t('table.uno')}</div>
      <div className="eo-badge" data-anim style={{ left: '50%', background: RED, ...anim('eo-caught', 0, -5) }}>{t('play.caught')}</div>
      <div className="eo-hand" style={{ left: '50%', marginLeft: -32, background: face(GREEN), color: INK.green }}>8</div>
      <div className="eo-hand" data-anim style={{ left: '50%', marginLeft: 2, background: face(RED), color: INK.red, ...anim('eo-leave', 0, -0.5) }}>8</div>
      <div className="eo-back" data-anim style={{ position: 'absolute', left: '50%', bottom: 10, marginLeft: 2, width: 26, height: 37, borderRadius: 5, ...anim('eo-flyback', 0, -5.6) }} />
      <div className="eo-back" data-anim style={{ position: 'absolute', left: '50%', bottom: 10, marginLeft: 12, width: 26, height: 37, borderRadius: 5, ...anim('eo-flyback', 0.12, -5.6) }} />
    </>
  );
}

/** Specials slide under the pile until a number turns up and the table settles. */
function SceneOpening() {
  const base: S = { position: 'absolute', left: '20%', top: '50%', width: 34, height: 48, marginTop: -27, borderRadius: 6, display: 'grid', placeItems: 'center' };
  return (
    <>
      <div className="eo-back" style={{ ...base, marginTop: -24, boxShadow: '0 5px 10px rgba(32,30,29,.22)' }} />
      <div className="eo-back" style={{ ...base, left: 'calc(20% + 3px)', boxShadow: '0 5px 10px rgba(32,30,29,.22)' }} />
      <div data-anim style={{ ...base, background: face(YELLOW), color: INK.yellow, fontSize: 16, boxShadow: 'inset 0 0 0 1.5px rgba(0,0,0,.18), 0 6px 12px rgba(32,30,29,.24)', ...anim('eo-under', 0, -1) }}>⊘</div>
      <div data-anim style={{ ...base, background: WILD, boxShadow: 'inset 0 0 0 1.5px rgba(0,0,0,.2), 0 6px 12px rgba(32,30,29,.26)', ...anim('eo-under', 1.8, -2.8) }}>
        <div className="eo-wildface" style={{ width: 17, height: 17 }} />
      </div>
      <div data-anim style={{ ...base, background: face(GREEN), color: INK.green, fontFamily: 'var(--font-heading)', fontSize: 15, boxShadow: 'inset 0 0 0 1.5px rgba(0,0,0,.18), 0 8px 14px rgba(32,30,29,.26)', ...anim('eo-stay', 3.6, -5.4) }}>5</div>
    </>
  );
}

const SCENES: Record<BasicInfo['id'], () => JSX.Element> = {
  match: SceneMatch,
  actions: SceneActions,
  wilds: SceneWilds,
  draw: SceneDraw,
  lastCard: SceneLastCard,
  opening: SceneOpening,
};

export default function LandingRules() {
  const { t, locale } = useT();
  return (
    <div className="lp-play">
      {BASICS_CATALOG.map((b) => {
        const Scene = SCENES[b.id];
        return (
          <article key={b.id} className="lp-card">
            <div className="lp-stage">
              <div className="lp-hatch" />
              <Scene />
            </div>
            <div>
              <div className="lp-card-head">
                <h3>{b.title[locale]}</h3>
                {/* The one place we leave official UNO. Say so, or a veteran reads it as a bug. */}
                {b.id === 'opening' && <span className="lp-tag">{t('play.ourRule')}</span>}
              </div>
              <p className="lp-line">{b.tagline[locale]}</p>
              <p className="lp-body">{b.details[locale]}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
