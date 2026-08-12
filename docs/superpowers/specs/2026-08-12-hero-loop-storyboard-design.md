# Ochre Eights — landing hero loop: animated video storyboard

Date: 2026-08-12.
Status: design approved in brainstorming; this document pending user review.
Belongs to: sub-project **B (Positioning + landing)** of `2026-08-12-beta-core-design.md`.
Supersedes: the "GIF demo" line in that spec's sub-project B row — the deliverable is a looping video, not a GIF.

## What we are making

A single muted, seamless, 14-second animated loop that plays full-bleed behind the landing page hero copy.
Its job is to sell the feel of Ochre Eights in the first two seconds of a visit,
  while letting the "Create room" call to action stay the only thing asking to be clicked.
It is ambience, not a trailer: there is no narrative, no voiceover, and no baked-in text.

### Approved decisions

| Topic | Decision |
|---|---|
| Purpose | Landing-page hero promo |
| Format | Seamless ambient loop, ~14 s, muted, autoplay |
| Content | Card choreography as the spine, soft-focus table glimpses behind |
| Placement | Full-bleed background, hero copy overlaid |
| Mood | Warm and premium, with exactly one accent punch per loop |
| Structure | Three-phase breathing loop (idle → punch → resettle) |

### Out of scope

No sound design, since the hero is muted.
No separate 9:16 master; the composition is center-weighted, so a center crop suffices for v1.
No 30-second trailer and no social cut-down.
Each of these can become its own piece of work later, and none of them block the hero.

## Palette

Taken from the checked-in design system
  (`design/_ds/organic-bda5c1fb-32bb-456d-af48-027563f741ed/styles.css`)
  and the card suit colors in `client/src/game.css`.

| Role | Hex |
|---|---|
| Ground / background field | `#f5ead8` |
| Surface / blob circles | `#ebddc5` |
| Accent (shockwave, glow) | `#c67139` |
| Ink (card glyphs, linework) | `#201e1d` |
| Suit — red | `#c23b2e` |
| Suit — yellow | `#e0a020` |
| Suit — green | `#66923f` |
| Suit — blue | `#2e6f8a` |

## Frame and composition

Canvas is 16:9, mastered at 1920×1080, 24 fps, 336 frames — so frame 336 is identical to frame 0.

Three depth layers, back to front:

1. **Ground.**
   The warm cream field (`#f5ead8`) carrying two or three oversized blob circles in the surface tone (`#ebddc5`), drifting at glacial speed.
   This is the same visual language as the current landing hero, so the video reads as an extension of the page rather than an insert.
2. **Mid-depth.**
   A soft-focus glimpse of the game table — oval felt, fanned "OE" card backs, the breathing live-dot glow — blurred in the upper right at low opacity.
   The table is present but never literal: it signals "this is a real game" without dating the video to the current UI.
3. **Foreground.**
   A loose fan of five oversized cards, center-right of frame: red 7, yellow 3, green skip, blue 5, and one OE back.
   Each bobs on its own slow sine wave.

### Text legibility

The video deliberately does **not** reserve an empty zone for copy.
Instead the whole frame stays inside a narrow, light luminance band — no dark patches, low saturation throughout —
  and the page lays a soft cream CSS scrim gradient behind the copy block.
This keeps the composition free to fill the frame,
  and it works both for desktop, where copy sits left, and for mobile, where copy stacks centered.

### Mobile

The composition is center-weighted: the card fan and the slam impact point both sit near frame center-right.
A 9:16 `object-fit: cover` center crop therefore still catches the whole performance, and no second master is needed.

## The loop, beat by beat

Timings are in seconds from loop start.

### Phase I — idle (0.0 – 6.0): the breathing table

| Time | Beat |
|---|---|
| 0.0 | Opening pose. Five cards fanned center-right, each bobbing on an independent slow sine. Blob circles drift. The table glimpse pulses its live-dot glow softly in the upper right. |
| 2.5 | The fan widens by a few degrees; the yellow card lifts about 20 px as if being considered, then eases back down. This is the "hmm" moment — the whole game in a single gesture. |
| 4.5 | Deep in the blurred background, one card back sails slowly left to right and out of frame. Someone else just played. |

### Phase II — punch (6.0 – 9.0): one slam per loop

| Time | Beat |
|---|---|
| 6.0 | A Wild +4 enters from the top right on an arc, slightly over-rotating. |
| 6.4 | **Slam.** It lands just right of center: a one-frame scale pop, a soft radial shockwave ring in accent terracotta (`#c67139`), and the fan cards scatter-bounce a few degrees outward. |
| 6.8 – 8.0 | A muted four-color ripple — the suit colors at low saturation — radiates from the impact and dissolves. Two penalty cards arc up and tumble down through the background, a nod to the in-game penalty rain. |
| 8.0 – 9.0 | The +4's glow fades. The frame exhales. |

### Phase III — resettle (9.0 – 14.0): return to pose

| Time | Beat |
|---|---|
| 9.0 – 11.5 | The scattered fan cards glide back into formation; the +4 slides under the fan and out of sight. |
| 11.5 – 14.0 | Everything eases to the exact opening pose. |

The punch lands at roughly 45 % through the loop,
  so a visitor who watches only a few seconds still has a good chance of catching it.

### Loop-closure constraint

The blob drift must complete exactly one full cycle per loop,
  and every bobbing sine must fit an integer number of cycles into 336 frames.
Satisfying this makes the seam mathematically invisible rather than merely well hidden.

## Generation

The loop is generated in Claude Design, inside the existing "Uno Online Game UI" project, so it inherits the Ochre Eights design system.

The generation spec carries two artifacts:

- A **master prompt** describing composition, palette hexes, depth layers, and mood.
- **Per-phase motion prompts** keyed to the timestamps above, usable whether the generator accepts one long prompt or separate per-phase clips.

Style references are stills exported from the checked-in prototypes:
  `design/Ochre Eights - Card Set.dc.html` for card faces,
  and `design/Ochre Eights - Animated Table.dc.html` for the felt and card backs.

### Iteration guardrails

Check every generated draft against three criteria, in this order:

1. **Seam.** First and last frame differ by approximately zero.
2. **Luminance.** The frame stays in the light band throughout — no dark patch ever drifts under the copy.
3. **On-model cards.** Suit colors and corner glyphs match the design system.

A draft that fails any of these is re-prompted rather than accepted and patched in post.

## Delivery

The 1920×1080 master is encoded to WebM (AV1 or VP9) with an MP4/H.264 fallback, targeting 4 MB or less for the 14 seconds.
The poster image is the opening-pose PNG, which is also the loop's frame 0 —
  so a paused or not-yet-loaded video is seamless with a playing one.

Landing-page integration:

- `<video autoplay muted loop playsinline poster=…>` behind the hero, with `object-fit: cover`.
- A cream CSS scrim gradient behind the copy block.
- `prefers-reduced-motion: reduce` swaps the video for the poster still.
- Mobile gets the center crop for free from `object-fit: cover`.

## Success criteria

The loop is done when all of the following hold:

- Playing it for 60 seconds in front of someone who has not seen it does not make them notice where it repeats.
- Hero copy and the "Create room" button remain legible at every frame, at desktop and at 375 px.
- The encoded file is at or under 4 MB and starts playing without a visible pop-in on a cold load.
- Someone who watches only the first three seconds still understands they are looking at a card game.
