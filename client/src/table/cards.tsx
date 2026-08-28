// Card faces for the table — ported from the Flexible prototype and the
// Card Set reference (design/Ochre Eights - Card Set.dc.html). Base card is
// 104×156; everything scales via transforms outside.
import type { ReactNode } from 'react';
import type { Card, Color } from '@uno/shared';

export const SUIT: Record<string, string> = {
  red: '#c23b2e', blue: '#2e6f8a', yellow: '#e0a020', green: '#66923f', wild: '#6b5f4a',
};
export const CREAM = '#f7eddc';
export const INK = '#2a2621';
export const COLOR_NAME: Record<Color, string> = {
  red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green',
};

export interface Face {
  v: string; bg: string;
  isText: boolean; isSkip: boolean; isRev: boolean; isWild: boolean;
  num: string; fs: number;
  /** Rank size inside the corner badge — the one place a fanned card still shows. */
  cfs: number;
}

export const faceOf = (c: Card): Face => {
  const suit = c.color ?? 'wild';
  const isSkip = c.value === 'skip', isRev = c.value === 'reverse', isWild = c.value === 'wild';
  const v = c.value === 'draw2' ? '+2' : c.value === 'wild4' ? '+4' : c.value;
  return {
    v, bg: SUIT[suit]!, isText: !isSkip && !isRev && !isWild, isSkip, isRev, isWild,
    num: suit === 'wild' ? '#4d4335' : SUIT[suit]!,
    fs: v.length > 1 ? 34 : 42,
    cfs: v.length > 1 ? 15 : 21,
  };
};

const SkipSvg = ({ size, width }: { size: number; width: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </svg>
);
const RevSvg = ({ size, width }: { size: number; width: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);
const WildDots = ({ dot, gap }: { dot: number; gap: number }) => (
  <span style={{ display: 'grid', gridTemplateColumns: `${dot}px ${dot}px`, gap }}>
    {(['red', 'blue', 'green', 'yellow'] as const).map((c) => (
      <span key={c} style={{ width: dot, height: dot, borderRadius: '50%', background: SUIT[c] }} />
    ))}
  </span>
);

/** The small rotated index in the bottom-right, as it always was. */
const corner = (child: ReactNode, pad: [number, number]) => (
  <span style={{
    position: 'absolute', bottom: pad[0], right: pad[1], transform: 'rotate(180deg)',
    fontFamily: 'var(--font-heading)', fontSize: 14, color: CREAM, display: 'grid',
  }}>{child}</span>
);

/** The top-left badge: a cream disc carrying the rank in the suit's own colour.
 *
 *  This corner is the only region inside both the fanned hand's left-edge sliver
 *  and a card's visible top band, so it is the one place a rank can be read when
 *  the hand is deep. It replaces a 14px cream index that vanished against the
 *  card at anything past ten cards. */
const badge = (child: ReactNode) => (
  <span style={{
    position: 'absolute', top: 3, left: 3, width: 30, height: 30, borderRadius: '50%',
    background: CREAM, boxShadow: '0 1px 3px rgba(42,38,33,.28)',
    display: 'grid', placeItems: 'center', zIndex: 2,
  }}>{child}</span>
);

/** The full 104×156 card front, matching the prototype's discard/hand faces. */
export function CardFront({ face, rim = INK }: { face: Face; rim?: string }) {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 15, background: face.bg,
      padding: 7, boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 10,
        border: `2.5px solid ${rim}`, display: 'grid', placeItems: 'center', position: 'relative',
      }}>
        {badge(
          face.isWild ? <WildDots dot={7} gap={2.5} />
            : face.isSkip ? <span style={{ color: face.num, display: 'grid' }}><SkipSvg size={18} width={3.2} /></span>
              : face.isRev ? <span style={{ color: face.num, display: 'grid' }}><RevSvg size={18} width={3.2} /></span>
                : <span style={{
                    fontFamily: 'var(--font-heading)', fontSize: face.cfs, lineHeight: 1, color: face.num,
                  }}>{face.v}</span>,
        )}
        {face.isText && corner(face.v, [2, 7])}
        {face.isSkip && corner(<SkipSvg size={13} width={3.4} />, [4, 7])}
        {face.isRev && corner(<RevSvg size={13} width={3.4} />, [4, 7])}
        {face.isWild && corner(<WildDots dot={5} gap={2} />, [5, 7])}
        <div style={{
          width: 62, height: 92, borderRadius: '50%', background: CREAM,
          transform: 'rotate(-16deg)', display: 'grid', placeItems: 'center',
        }}>
          {face.isWild
            ? <span style={{ transform: 'rotate(16deg)', display: 'grid' }}><WildDots dot={21} gap={5} /></span>
            : face.isSkip
              ? <span style={{ color: face.num, transform: 'rotate(16deg)', display: 'grid' }}><SkipSvg size={40} width={2.75} /></span>
              : face.isRev
                ? <span style={{ color: face.num, transform: 'rotate(16deg)', display: 'grid' }}><RevSvg size={38} width={2.75} /></span>
                : <span style={{
                    fontFamily: 'var(--font-heading)', fontSize: face.fs, color: face.num,
                    transform: 'rotate(16deg)',
                  }}>{face.v}</span>}
        </div>
      </div>
    </div>
  );
}

/** The draw pile's top back with the three concentric rings. */
export function PileBack() {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, width: 104, height: 156, borderRadius: 15,
      background: INK, padding: 7, boxSizing: 'border-box', boxShadow: 'var(--shadow-md)',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 10,
        border: '2px solid rgba(247,237,220,.35)', display: 'grid', placeItems: 'center', overflow: 'hidden',
      }}>
        <div style={{ width: 110, height: 110, borderRadius: '50%', border: '7px solid var(--color-accent)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <div style={{ width: 74, height: 74, borderRadius: '50%', border: '7px solid #7a8a5e', display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', border: '7px solid #e0a020', boxSizing: 'border-box' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
