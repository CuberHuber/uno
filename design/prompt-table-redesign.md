# Prompt for Claude Design — the table: seating, a readable hand, touch, history

Date: 2026-08-28. Paste the block below into Claude Design, working on
`Ochre Eights - Full Game Flexible.dc.html`.

**Attach the two sketches before sending** — the table's look, and the hand drum.
Where a sketch and this text disagree, the sketch wins; say so in the reply and
carry on.

Everything after the rule is the prompt.

---

Edit `Ochre Eights - Full Game Flexible.dc.html`. It has one artboard,
`data-screen-label="Full game"`.

## Why this file and not another

This prototype is the source of the shipped table, not a picture of it.
`client/src/table/layout.ts` is a straight port of this file's `L()` layout
function — including the portrait predicate `vw < 720 || vh > vw * 1.15` — and
every `ob-*` keyframe in `client/src/game.css:495-541` was copied out of here.
Whatever you decide here gets ported back into code by hand.

So: keep the structural vocabulary. Named anchors that a `L(w, h)` function can
return, one absolutely-positioned block per seat, transforms rather than layout
reflow. A design that needs flexbox reflow at the table level is a design we
cannot port.

## Design system — inherit it, do not start a second one

Tokens: `_ds/organic-bda5c1fb-32bb-456d-af48-027563f741ed/styles.css`, mirrored
live in `client/src/ds.css`. Game-layer palette in `client/src/game.css:4-17`.

| Role | Token / hex |
|---|---|
| Ground | `--color-bg` `#f5ead8` |
| Felt (stage) | `--felt` `#dfe6cd` |
| Accent (ochre) | `--color-accent` `#c67139` |
| Second accent (olive) | `--color-accent-2` `#7a8a5e` |
| Ink | `--color-text` `#201e1d` |
| Suits | red `#c23b2e` · blue `#2e6f8a` · yellow `#e0a020` · green `#66923f` |
| Wild | `#6b5f4a` · card back `#2a2621` · card cream `#f7eddc` |

Headings `Caprasimo` (`--font-heading`), body `Figtree`. Spacing is a 4.4px base
(`--space-1..8`, no `-5`, no `-7`). Every small control is a pill
(`border-radius: 999px`, `ds.css:256`). Shadows are ink-tinted, three steps.
There are three tonal ramps on one shared lightness scale — neutral, accent,
accent-2, 100→900 — so step *n* of one matches step *n* of another in value.

Do not add a font, a colour outside these ramps, or a JS dependency.

## The space you are designing into

Two design spaces, chosen by that portrait predicate:

- **Landscape 1180 × 720**, scale `min(vw/1180, vh/720, 1.15)`
- **Portrait 640 × 1120**, scale `min(vw/640, vh/1120, 1.15)`

Scale is capped at 1.15 in both. The stage is then the *real viewport expressed
in design units*, so anchors must be derived from `W`/`H`, not hardcoded to
1180/720. Every task below has to answer for both spaces. **The tablet range is
the one that has never been designed** — there is exactly one CSS breakpoint in
the whole client (`max-width: 720px`) and it does not touch the table at all.

Maximum four players: you, plus at most three opponents.

---

# 1. Seat the other players around the table

**Now:** all three opponents sit in a row across the top edge, at 15% / 50% /
85% of the width, the middle one 18px higher than its neighbours. That 18px is
the only curvature in the design. Nobody ever appears at the sides or the
bottom. With two players the centre slot is left empty and the two flanking
ones are used.

**Wanted:** the other players arranged around a virtual round table. The viewer
is always at the bottom, looking at the table through their own eyes — a
first-person seat, not a seat in a list.

Specify the arc for each case:

- **2 players** — one opponent, directly opposite.
- **3 players** — two opponents, upper-left and upper-right.
- **4 players** — three opponents: left, opposite, right.

Constraints the arc has to respect:

- A seat block is **220px wide**, scaled by `seatScale` (1 landscape, 0.74
  portrait), anchored top-left with its centre also exposed — flights fly card
  backs to and from that centre point, so both numbers must survive.
- Each block carries a fanned pile of card backs, **200 × 78**, at most **nine**
  backs regardless of how many cards the player holds, fanned 7° apart.
- The middle of the felt must stay clear: the 350px dashed direction ring, the
  draw pile and discard (104 × 156 each), the called-colour splash, the big `+N`
  counter, the pot pill and the toast all live there.
- Portrait is tall and narrow (640 × 1120). A circle that works at 1180 × 720
  may have to become an arc squeezed toward the top in portrait — decide and
  show both.

Deliver the anchor set as a small table of coordinates expressed in `W`/`H`, so
it ports to `layout.ts` directly.

# 2. Put the current player's marker under their own hand

**Now:** your avatar, name pill and `YOUR TURN` badge sit in the **bottom-left
corner** (30, 26 landscape · 14, 12 portrait), nowhere near your cards, which
are fanned around the horizontal centre.

**Wanted:** the indicator and its oval centred beneath the viewer's own hand.

Two things to settle while you are in there:

- The avatar currently sits inside a 46 × 46 circle filled with
  `conic-gradient(var(--color-accent) 72%, var(--color-neutral-200) 0)`. It
  reads as a progress ring at 72% — **but 72% is a hardcoded constant that never
  moves.** Either give the ring something real to count (the catch window is the
  only timed thing at the table, and it already has a 2s drain bar on the UNO
  button), or drop the ring shape and mark the turn some other way. A dial that
  never turns is worse than no dial.
- A wide radial glow already washes accent light up under your hand when it is
  your turn. The new centred marker sits inside that glow — make sure they read
  as one idea and not two.

# 3. The card face has to survive a big hand on a tablet

**Now:** cards are 104 × 156. The rank appears three times — a 14px index in the
top-left, the same rotated 180° in the bottom-right, and a large glyph (42px, or
34px for `+2` / `+4` / `10`) inside a 62 × 92 cream oval tilted −16°.

The fan is an arc of radius 520 about a pivot below the stage, with a per-card
spread of `min(6.5°, spreadTot / (n - 1))` where `spreadTot` is 60° landscape
and 46° portrait. The consequence is the problem:

- Up to 10 cards the spread is a flat 6.5° and the fan simply grows.
- **From 11 cards the total arc locks** and every further card subdivides the
  same wedge.
- At 15 cards each card shows about **39px of its 104px width — 63% hidden**. At
  20 cards, 72% hidden. At 25, 78%.
- The visible sliver is the card's **left edge**. The top-left index is inside
  it; the big central glyph is not.
- In portrait the fan is 510px inside a 640px space — 80% of the width.

**Wanted:** the rank readable on a tablet even with a lot of cards, and a
two-level hand explored as the way there.

Address both halves:

- **The face.** What identifies a card in a 39px left-edge strip? A larger or
  bolder index, a repeated vertical rail down the left edge, a colour band, a
  different index position — your call, but it must work for numbers, `+2`,
  `+4`, skip, reverse and the four wild dots, and it must not turn the card into
  a different object from the ones in `Ochre Eights - Card Set.dc.html`.
- **Two rows.** At what count does the second row appear, how do the rows
  overlap, which row is nearer the player, and how does a card move between
  them? Show 7, 12 and 20 cards, in both spaces. Note that the hand today also
  lifts playable cards 9px, lifts a hovered card 52px, and pushes its
  neighbours sideways by 26 / 14 / 6px — at 15+ cards that push is *wider than
  the gap between cards*, so the fan visibly buckles. A two-row layout should
  make that shove unnecessary.

# 4. Touch: the hand becomes a drum

**Now, precisely:** looking at a card is `onMouseEnter` / `onMouseLeave` and
nothing else. There is no `onPointer*`, no `onTouch*`, no drag, no swipe, no
long-press anywhere on a card in the entire client, and no `touch-action` or
`user-select` declaration. A tap on a touch screen goes straight to the click
handler, which plays the card. **So on a phone or tablet there is currently no
way to inspect a card before committing to it** — the 52px peek exists, but the
same gesture that triggers it also spends the card.

**Wanted:** on touch devices the hand becomes a drum the player spins with a
finger. Every card is clearly legible as it passes the focus position, and
playing is a second, deliberate act.

The sketch is the authority on the shape. What the design still has to answer:

- How many cards are visible at once, and how the focused one is distinguished.
- What the commit gesture is — tap the focused card? drag it to the discard? a
  separate button? — and how a misfire is undone.
- What happens to the drum when it is **not** your turn, and how the playable /
  unplayable distinction survives (today: a 9px lift plus an accent outline, and
  a cream wash over dead cards).
- How it degrades on a mouse: does the drum replace the fan everywhere, or only
  under `pointer: coarse`? Note the client already detects coarse pointers, but
  only to label analytics — it has never been used for layout.
- Keyboard and screen-reader equivalents. The current fan has none either; this
  is the moment to fix that rather than port the gap.
- Momentum and rubber-banding: a spring that keeps moving after the finger
  leaves needs a duration, and it must obey `prefers-reduced-motion`.

Do not make the common case slower. Most turns are "play the one obvious card" —
that must stay one gesture.

# 5. A move history for the room, hidden by default

**Wanted:** in the room, every player can open the sequence of everyone's moves.
Closed by default.

Most of this already exists and should be reused rather than reinvented:

- The server keeps a per-room journal of up to **200 transactions**, each with a
  sequence number, a timestamp, who acted, what they did and the board state
  afterwards. It is projected per seat, and by construction it says nothing a
  player could not already see — so showing the whole thing to everyone leaks
  nothing.
- The client already turns those entries into one-line sentences in two
  languages, and already renders them as a scrolling list with a "this one is
  yours" treatment (a 3px accent left rule) and a centred divider chip where a
  new round starts.
- Today that list only ever appears as a modal **after a reconnect**, showing
  only what you missed. Making it a permanent panel is our protocol work, not
  yours — design it as though the data is always there.

What to design:

- Where the handle lives on the felt. The top-left already carries the round
  chip, the house-rule chips, the `?` help button and the sound switch; the
  top-right carries `Leave`. Do not crowd either.
- Open and closed states, and the transition. A side sheet, a bottom sheet and
  an expanding chip are all plausible — pick one and say why.
- How it reads at 375px wide, where it will want to be a bottom sheet like the
  rules panel already is.
- How it says **"older moves are gone"** when the journal has been trimmed past
  200, and how it marks the boundary where a rematch renumbered the seats. Both
  states exist in the data already.
- Whether it shows timestamps, and whether it stays open while play continues —
  if it does, it needs to scroll without stealing the turn.

# 6. Motion: a turn has to read as a sequence

**The engineering half of this is ours** — the client currently drops effects
that arrive in the same network flush, so a three-action turn can render as one.
We are fixing that. What we need from you is the timing contract it should
satisfy.

Current durations, for calibration: a card flight is 620ms; an opponent's draw
460ms; the `+4` slam lands 550ms after its effect; the called-colour splash
crossfades over 620ms; a reshuffle flip is 800ms; new cards leave the pile
staggered 90 + 150ms each. Opponent flights are already serialised one at a
time; everything else fires immediately and can overlap.

Answer:

- How long is **one beat** — the smallest complete "something happened" a
  spectator can register?
- How do consecutive beats separate? A hard gap, a partial overlap, or a
  shared envelope?
- Draw a **three-action turn** end to end — say, draw, draw, play — as a
  timeline, in both the actor's view and a spectator's.
- What compresses when a burst is long? A player forced to draw eight cards
  cannot cost eight full beats, but the count must still land.
- `prefers-reduced-motion: reduce` is honoured today and must stay honoured.
  Say what the sequence becomes when motion is off — it still has to be
  followable.

---

## Not in this prompt

These are ours, listed so you know they are handled and can design as if they
were already true: the dropped-effect bug and the ordering it breaks; the new
protocol that keeps the move journal on the client during live play; the music
volume control.

## Constraints that are not negotiable

- **Two languages, Russian and English**, switched in-game and persisted.
  Russian runs longer — never tune a line break to the English alone.
- **The server is authoritative.** The board only ever shows what the server
  said; nothing may depend on the client deciding a rule. The list of cards you
  may legally play now arrives from the server.
- **Four players maximum**, nine card backs maximum per opponent.
- **`prefers-reduced-motion: reduce`** already works. Keep it working.
- **No new font, no new dependency, no second design system.**
- The stage is transform-scaled. Anything `position: fixed` inside it falls out
  of its coordinate space — full-screen overlays must be mounted outside the
  stage, as the rules sheet already is.

## Open questions worth an opinion

- Does the circular table get a drawn edge — a felt oval with a rim — or does
  the seating alone imply it? The dashed direction ring is already circular and
  may be doing that job.
- With seats moved off the top edge, does the round/rules chip cluster stay
  top-left, or does the freed space change where the furniture goes?
- Should the two-row hand and the touch drum be the same answer at different
  sizes, or two genuinely different interactions?
- Is the history panel a spectator tool or a rules tool? If a player can check
  whether someone called their last card, it changes how the catch window feels.
