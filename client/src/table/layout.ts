// Stage geometry — a straight port of L() from
// design/Ochre Eights - Full Game Flexible.dc.html. The table is laid out in a
// fixed design space and scaled to the viewport; portrait gets its own anchors.
//
// The seats used to be a row across the top edge. They now sit on a circle
// about the table's centre, and the table itself is a drawn object — a rimmed
// round felt — rather than a background colour. Both come from the redesign in
// that artboard; the reasoning behind each number is in `table-redesign-answers.md`
// in the "Table redesign sketches review" Claude Design project.
export interface StageLayout {
  W: number; H: number; scale: number;
  /** The table: a rimmed disc. The rim is padding, the felt is the inner disc. */
  tblL: number; tblT: number; tblW: number; tblH: number; rimW: number;
  feltL: number; feltT: number; feltD: number;
  /** The direction ring, now a dashed ellipse just inside the rim. */
  ringL: number; ringT: number; ringW: number; ringH: number;
  pileX: number; pileY: number; discX: number; discY: number;
  /** Where the "N left" hint sits relative to the pile — above it, not below. */
  pileHintT: number;
  cx: number; anchorY: number; R: number; spreadTot: number;
  /** Two-row hand: how far the front row drops, and how the rows offset sideways. */
  rowGap: number; rowShift: number;
  glowL: number; glowR: number; tintX: number; tintY: number;
  seatScale: number;
  /** One anchor per opponent, in seating order. `ang` drives the pill mirroring. */
  seats: { x: number; y: number; cx: number; cy: number; ang: number }[];
  pendTop: number; toastTop: number; pickTop: number; chipX: number; chipY: number;
  /** Your own marker, now centred under your hand rather than in the corner. */
  meW: number; meB: number;
  unoL: number; unoB: number; endR: number; endB: number;
  bigFs: number; ngR: number; ngT: number;
  /** Design-space width the open move sheet takes from the stage; 0 when shut
   *  and always 0 in portrait, where the sheet comes up from the bottom. */
  shW: number;
  portrait: boolean;
}

/** Seats on a circle about the table centre. 0° is straight across from the
 *  viewer, positive clockwise. The block is 220 wide and scaled from its top
 *  centre, so the y offset carries the scale — otherwise the fan of backs
 *  drifts off its anchor at 0.74. */
function arc(
  angles: number[], mx: number, cy: number, radius: number, ss: number,
): StageLayout['seats'] {
  const r = Math.round;
  return angles.map((ang) => {
    const t = (ang * Math.PI) / 180;
    const px = mx + Math.sin(t) * radius;
    const py = cy - Math.cos(t) * radius;
    return { x: r(px - 110), y: r(py - 52 * ss), cx: r(px), cy: r(py), ang };
  });
}

/** The angle set, not a squashed ellipse, is what keeps the outermost seats
 *  inside a 640-wide portrait space: at ±60° a 0.74-scaled block just clears
 *  both edges. */
const ANGLES = {
  landscape: [[0], [-58, 58], [-84, 0, 84]],
  portrait: [[0], [-46, 46], [-60, 0, 60]],
};

/** With the move sheet open the seats pull in and up: a narrower felt puts the
 *  hand's outer cards where the side pills were. */
const ANGLES_NARROW = [[0], [-44, 44], [-56, 0, 56]];

export function stageLayout(
  vw: number, vh: number, opponents = 3, histOpen = false,
): StageLayout {
  const portrait = vw < 720 || vh > vw * 1.15;
  const r = Math.round;
  const nOpp = Math.max(1, Math.min(3, opponents));
  const angles = (portrait ? ANGLES.portrait : ANGLES.landscape)[nOpp - 1]!;
  if (portrait) {
    const k = Math.min(vw / 640, vh / 1120, 1.15);
    const W = r(vw / k), H = r(vh / k), mx = W / 2;
    // Felt and seat ring are both true circles, so the gap from rim to seat is
    // the same at every seat.
    const ss = 0.74;
    const tcy = r(H * 0.32);
    // Capped against the top edge as landscape is. On a phone `W` is 640 and
    // 0.34·W wins; on a tablet held upright `W` grows past 800, and an uncapped
    // radius pushes the far seat's block clean off the stage (measured: y = -24
    // at 834×1112). 106 = the 58px rim-to-seat gap plus the scaled half-block.
    const tR = Math.max(150, Math.min(r(W * 0.34), tcy - 106));
    const sR = tR + 58;
    const rimW = Math.max(14, r(tR * 0.088));
    // High enough that the pile's lower corners stay inside the round felt.
    const pileY = r(H * 0.30);
    // Portrait keeps the hand at the bottom, where a thumb can reach it. The
    // landscape rule below derives the pivot from the table instead, because
    // there the hand sits against the felt; here the table is up top and the
    // space beneath it is the hand's own. 322 clears the marker at the very
    // bottom: the widest fan's outer card lands 11px above it.
    const anchorY = H + 322;
    return {
      W, H, scale: k, portrait,
      tblL: r(mx - tR), tblT: r(tcy - tR), tblW: tR * 2, tblH: tR * 2, rimW,
      feltL: r(mx - tR) + rimW, feltT: r(tcy - tR) + rimW, feltD: tR * 2 - 2 * rimW,
      ringL: r(mx - tR + 26), ringT: r(tcy - tR + 26), ringW: tR * 2 - 52, ringH: tR * 2 - 52,
      pileX: r(mx - 122), pileY, discX: r(mx + 18), discY: pileY, pileHintT: -30,
      cx: mx, anchorY, R: 520, spreadTot: 46, rowGap: 40, rowShift: 15,
      glowL: r(W * 0.06), glowR: r(W * 0.06), tintX: mx, tintY: pileY + 78,
      seatScale: ss,
      seats: arc(angles, mx, tcy, sR, ss),
      pendTop: pileY - 180, toastTop: pileY - 125, pickTop: pileY + 190,
      chipX: r(mx - 65), chipY: pileY + 174,
      meW: 250, meB: 12, unoL: 14, unoB: 236, endR: 14, endB: 16,
      bigFs: 88, ngR: 16, ngT: 12, shW: 0,
    };
  }
  const k = Math.min(vw / 1180, vh / 720, 1.15);
  const W = r(vw / k), H = r(vh / k), my = H / 2;
  // The move sheet is 372 REAL px, mounted outside the transform-scaled stage,
  // so it costs 372/k DESIGN px. The table does not sit under it — it recentres
  // into what is left. Only anchors move; nothing reflows.
  const shW = histOpen ? Math.min(r(372 / k), r(W * 0.42)) : 0;
  const availW = W - shW, mx = r(availW / 2);
  const tcy = r(H * 0.47), ss = 1;
  // Capped by tcy-140 as well: past that the far seat's own fan of backs leaves
  // the top of the stage. Floored because below 170 the pile+discard cluster no
  // longer fits inside a CIRCLE — its far corner is hypot(dx, dy) from the
  // centre, not dx — and the piles end up straddling the rim.
  // 150, not the prototype's 140: at 140 the far seat's block lands at exactly
  // y = 0 and its fan's rotated outer corners are shaved off by the stage edge.
  const tR = Math.max(170, r(Math.min(H * 0.32, availW * (shW ? 0.30 : 0.28), tcy - 150)));
  const sR = tR + 88;
  const rimW = Math.max(14, r(tR * 0.088));
  // The central pair is a tight cluster: a round felt small enough to leave the
  // hand its bottom fifth would otherwise let the two cards cross the rim.
  const anchorY = r(tcy + 0.6 * tR + 520 + 87);
  return {
    W, H, scale: k, portrait,
    tblL: r(mx - tR), tblT: r(tcy - tR), tblW: tR * 2, tblH: tR * 2, rimW,
    feltL: r(mx - tR) + rimW, feltT: r(tcy - tR) + rimW, feltD: tR * 2 - 2 * rimW,
    ringL: r(mx - tR + 28), ringT: r(tcy - tR + 28), ringW: tR * 2 - 56, ringH: tR * 2 - 56,
    pileX: r(mx - 118), pileY: r(my - 117), discX: r(mx + 14), discY: r(my - 110),
    pileHintT: -30,
    cx: mx, anchorY, R: 520, spreadTot: shW ? 52 : 60, rowGap: 40, rowShift: 16,
    glowL: r(mx - 342), glowR: r(W - mx - 342), tintX: mx, tintY: r(my - 30),
    seatScale: ss,
    seats: arc(shW ? ANGLES_NARROW[nOpp - 1]! : angles, mx, tcy, sR, ss),
    pendTop: r(my - 212), toastTop: r(my - 160), pickTop: r(my - 130),
    chipX: r(mx + 182), chipY: r(my - 55),
    meW: 260, meB: 26, unoL: 34, unoB: 150,
    // Right-anchored furniture measures from the sheet's inner edge.
    endR: shW + 34, endB: 32,
    bigFs: 120, ngR: shW + 24, ngT: 20, shW,
  };
}
