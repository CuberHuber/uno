// Stage geometry — a straight port of L() from
// design/Ochre Eights - Full Game Flexible.dc.html. The table is laid out in a
// fixed design space and scaled to the viewport; portrait gets its own anchors.
export interface StageLayout {
  W: number; H: number; scale: number;
  ringL: number; ringT: number;
  pileX: number; pileY: number; discX: number; discY: number;
  cx: number; anchorY: number; R: number; spreadTot: number;
  glowL: number; glowR: number; tintX: number; tintY: number;
  seatScale: number;
  seats: { x: number; y: number; cx: number; cy: number }[];
  pendTop: number; toastTop: number; pickTop: number; chipX: number; chipY: number;
  youL: number; youB: number; unoL: number; unoB: number; endR: number; endB: number;
  bigFs: number; ngR: number; ngT: number;
  portrait: boolean;
}

export function stageLayout(vw: number, vh: number): StageLayout {
  const portrait = vw < 720 || vh > vw * 1.15;
  const r = Math.round;
  if (portrait) {
    const k = Math.min(vw / 640, vh / 1120, 1.15);
    const W = r(vw / k), H = r(vh / k), mx = W / 2;
    const pileY = r(H * 0.36);
    return {
      W, H, scale: k, portrait,
      ringL: r(mx - 175), ringT: pileY - 97,
      pileX: r(mx - 122), pileY, discX: r(mx + 18), discY: pileY,
      cx: mx, anchorY: H + 368, R: 520, spreadTot: 46,
      glowL: r(W * 0.06), glowR: r(W * 0.06), tintX: mx, tintY: pileY + 78,
      seatScale: 0.74,
      seats: [
        { x: r(W * 0.16 - 110), y: 52, cx: r(W * 0.16), cy: 110 },
        { x: r(mx - 110), y: 40, cx: mx, cy: 96 },
        { x: r(W * 0.84 - 110), y: 52, cx: r(W * 0.84), cy: 110 },
      ],
      pendTop: pileY - 180, toastTop: pileY - 125, pickTop: pileY + 190,
      chipX: r(mx - 65), chipY: pileY + 174,
      youL: 14, youB: 12, unoL: 14, unoB: 200, endR: 14, endB: 16,
      bigFs: 88, ngR: 16, ngT: 12,
    };
  }
  const k = Math.min(vw / 1180, vh / 720, 1.15);
  const W = r(vw / k), H = r(vh / k), mx = W / 2, my = H / 2;
  return {
    W, H, scale: k, portrait,
    ringL: r(mx - 175), ringT: r(my - 205),
    pileX: r(mx - 162), pileY: r(my - 117), discX: r(mx + 58), discY: r(my - 110),
    cx: mx, anchorY: H + 310, R: 520, spreadTot: 60,
    glowL: r(W * 0.21), glowR: r(W * 0.21), tintX: mx, tintY: r(my - 30),
    seatScale: 1,
    seats: [
      { x: r(W * 0.15 - 110), y: 36, cx: r(W * 0.15), cy: 88 },
      { x: r(mx - 110), y: 18, cx: mx, cy: 70 },
      { x: r(W * 0.85 - 110), y: 36, cx: r(W * 0.85), cy: 88 },
    ],
    pendTop: r(my - 212), toastTop: r(my - 160), pickTop: r(my - 130),
    chipX: r(mx + 182), chipY: r(my - 55),
    youL: 30, youB: 26, unoL: 34, unoB: 120, endR: 34, endB: 32,
    bigFs: 120, ngR: 24, ngT: 20,
  };
}

/** Opponent seat → anchor slot: 1 opp sits top, 2 sit left+right, 3 take all. */
export const seatSlots = (count: number): number[] =>
  count === 1 ? [1] : count === 2 ? [0, 2] : [0, 1, 2];
