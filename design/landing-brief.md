# Ochre Eights — landing page brief for Claude Design

Date: 2026-08-18. For: art-directing the landing in Claude Design.
Spec: `docs/superpowers/specs/2026-08-18-landing-design.md` (sub-project B).
The current build is real and running — this brief describes what exists, what is
  locked, and what still needs a designer's eye.

## What the page has to do

One job: get a visitor to press **Create a room** within a few seconds, and make
  them believe there is a real game behind the button.

There is no signup, no pricing, no account. The product is a private table you make
  in ten seconds and send to friends by link. Everything on the page serves that or
  gets cut.

## Locked — do not redesign these

Decided by the client, not open for a second opinion:

| | |
|---|---|
| Hero | Real gameplay video, **full-bleed** behind the copy |
| Video format | Short silent looping clips — not GIFs, not one long video with controls |
| Page shape | Scrolling page with sections |
| Call to action | **Pinned to the viewport, not the page** — reachable from any scroll position |
| Motion | Scroll-driven animation as sections come into view |
| Sound | Quiet UI sounds only (hover, create-room), after the visitor's first gesture |

The framed-hero alternative was built, compared and rejected. The old static card
  fan is gone.

## The assets, ready to use

All under `client/public/clips/`, served from `/clips/…`. Each has a WebM, an MP4
  fallback, and a poster taken from its own first frame.

| File | Size | Length | What it shows |
|---|---|---|---|
| `hero.*` | 1600×900 | 7.0 s | **The hero.** Pick a colour → the +4 lands → shockwave → the pot passed on |
| `slam.*` | 720 px sq | 7.0 s | The same beat, square, uncropped |
| `turn.*` | 720 px sq | 5.0 s | A plain turn: four full hands, a card chosen and played |
| `wild.*` | 720 px sq | 7.0 s | A wild going down, the called-colour wash flooding the table |
| `lastcard.*` | 720 px sq | 6.5 s | UNO called, the catch window, the last card, the +2 counter |

Total weight about 1.4 MB for all fifteen files. Re-cut everything with
  `bash tools/cut-landing-clips.sh` — timestamps and crop live at the top of that
  script, so a new in-point is a one-line edit and a re-run.

### Two things about the video that will bite if forgotten

**It is HDR.** The source recording is HDR10 (BT.2020 primaries, PQ transfer,
  10-bit). Anything that re-encodes it without tone-mapping comes out grey and
  desaturated — it looks like a bad recording, but it is a colour-space mismatch.
The tone-map chain is in the cut script; do not hand-roll a second one.

**It is square.** The recording is 2294×2242. The hero clip is therefore *widened*,
  not cropped: the whole square sits centred at full height and the gutters are
  filled with a blurred, scaled-up copy of the same frame. A straight 16:9 crop
  would cut the player chips off the top, and those chips are the only thing on
  screen saying four people are at this table.

## Design system

Inherit it, do not invent a second one.

- Tokens and usage guide: `design/_ds/organic-bda5c1fb-…/` (the "Organic" DS).
- Finished screens to match: `design/Ochre Eights - Full Game Flexible.dc.html`,
    `design/Ochre Eights - Card Set.dc.html`.
- Live CSS: `client/src/ds.css` (tokens) and `client/src/game.css` (game layer).

Palette in play on this page:

| Role | Hex |
|---|---|
| Ground / page | `#f5ead8` |
| Felt (the video's own field) | `#dfe6cd` |
| Accent (buttons, brand mark) | `#c67139` |
| Ink | `#201e1d` |
| Suits | red `#c23b2e`, yellow `#e0a020`, green `#66923f`, blue `#2e6f8a` |

Headings use the DS display face; the brand mark is a circled **8**.

## Page structure to art-direct

1. **Hero** — headline, subhead, create/join buttons, the hero clip behind it all.
     Copy is already written and translated (`landing.h1a` / `h1b` / `sub`).
2. **How it works** — three steps: create a room, send the link, deal.
3. **House rules** — four host toggles, title and one-line tagline each, pulled from
     `shared/src/rulesCatalog.ts`. Do not rewrite this prose here: it is the same
     text the game itself shows, and it must not fork.
4. **See it** — the other three clips, captioned by what they show.
5. **Close** — a last full-width call to action.

### The pinned call to action

The create/join controls follow the viewport rather than sitting in the hero. A
  visitor who has scrolled to the rules and decided should be one tap from a room.

Things it has to get right, and where a designer earns their keep:

- On a phone it becomes a bottom bar. Keep it clear of the home indicator, and never
    let it cover a clip's caption.
- It must not double up: while the hero's own buttons are on screen, the pinned bar
    should stay out of the way.
- The join flow has a second step (a 5-character code, then sometimes a PIN). That
    has to work inside the bar without turning it into a form.
- Keyboard order stays sane and focus is never trapped.

## Known problems in the current build

Honest list — these are the things worth fixing first.

1. **A faint vertical seam** around 84% of the frame width, where the hero's sharp
     square meets its blurred fill. The right-hand rise in the scrim mostly hides it.
     A softer edge, a wider blur, or a different fill treatment would kill it.
2. **The right third of the hero is empty.** The composition is centre-weighted, so
     on a wide screen the copy sits left and the right side carries nothing.
3. **The mobile hero is unresolved.** The copy stacks centred over a portrait crop of
     a landscape clip. It works; it is not designed.
4. **The scrim is doing a lot of work.** Two stacked gradients, tuned by hand. If the
     hero composition changes, they need retuning.

## Constraints that are not negotiable

- **Legibility over drama.** Hero copy and the create button must stay readable at
    every frame of the loop, at desktop and at 375 px. The clip is bright and busy,
    and there is no dark patch to hide text on — which is why the scrim exists.
- **`prefers-reduced-motion: reduce`** swaps every clip for its poster and drops the
    section animations. Already wired; keep it working.
- **Nothing autoplays with sound.** Browsers block it and it is rude. UI sounds wait
    for the first gesture and have a visible, persisted mute.
- **Clips pause off-screen.** Four autoplaying videos at once is wasted battery.
- **Two languages.** Every string is Russian and English, switched in the header and
    persisted. Russian runs longer than English — leave room, and do not tune line
    breaks to the English alone.
- **Weight.** Stay near the current ~1.4 MB of media. Do not add a font file, a video
    library, or a second Chromium-sized dependency.

## Deliberately out of scope

No blog, no pricing, no testimonials, no team page — there is nothing to charge for
  and nobody to quote. No interactive demo of the game on the landing: the clips make
  the point and the real thing is one button away.

## Open questions for the designer

- Does the hero stay on the `slam` beat, or does a calmer moment make a better first
    two seconds, with the slam moved down to the "see it" section?
- Does the language switcher stay in the header, or move into the pinned bar?
- Should the hero carry a fifth element on the empty right — a rule chip, a seat
    count, a "no account needed" line — or is the emptiness the point?
- The recording contains no multi-discard: it was a classic-rules game. A clip of that
    rule needs a fresh capture. Worth it, or does the rules section carry it in prose?
