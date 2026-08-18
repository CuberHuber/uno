# Ochre Eights — sub-project B: positioning and landing

Date: 2026-08-18.
Status: scope decided with the user; open questions listed at the end.
Belongs to: sub-project **B** of `2026-08-12-beta-core-design.md`.

**Supersedes `2026-08-12-hero-loop-storyboard-design.md` and its plan.**
That spec called for a 14-second authored abstract loop — drawn cards and drifting blobs,
  no product visible, 336 hand-tuned frames.
The user chose real gameplay instead: we already have a recording, it shows the actual
  product, and it costs a transcode rather than seven implementation tasks.
The authored-loop documents stay unmerged on `worktree-beta-core-spec` as a record of the
  path not taken.

## Decisions

| Topic | Decision |
|---|---|
| Hero | Real gameplay, cut from `gameplay.mov` |
| Video format | Short silent looping clips — **not** GIFs, **not** one long video |
| Page shape | Scrolling page with sections |
| Call to action | **Fixed to the viewport, not to the page** — always reachable while scrolling |
| Motion | Scroll-driven animation as sections come into view |
| Sound | Quiet UI sounds (hover, create-room click), after the first user gesture |

## The source recording

`gameplay.mov` at the repo root — a four-player round, screen-recorded.

| | |
|---|---|
| Duration | 3:54 (234 s) |
| Frame | 2294 × 2242 — square, a browser window, not 16:9 |
| Rate | 60 fps |
| Codec | HEVC Main 10, 10-bit |
| Colour | **BT.2020 primaries, SMPTE 2084 (PQ) — HDR10** |
| Audio | AAC (discarded; every clip is silent) |
| Size | 159 MB |

### The HDR trap

This is the one finding that decides whether the clips look right.

A macOS HDR screen capture decoded naively into SDR comes out grey and desaturated:
  the warm cream table turns muddy, the suit colours lose their punch.
It looks like a bad recording; it is actually a colour-space mismatch.
Every encode must tone-map:

```
zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,
tonemap=tonemap=hable:desat=0,
zscale=t=bt709:m=bt709:r=tv,format=yuv420p
```

Verified against a frame at 78 s: without the chain the felt reads grey-green,
  with it the green called-colour wash, the ringed card back and the player chips
  all come back true.
Requires an ffmpeg with libzimg — the dev machine has it, along with libvpx and libx264.

### Measured cost

A 5-second clip, tone-mapped, 30 fps, 720 px wide:

| Format | Encoder | Size |
|---|---|---|
| WebM | libvpx-vp9, `-crf 34 -b:v 0` | **76 KB** |
| MP4 | libx264, `-crf 26 -preset slow` | **76 KB** |

Four clips in both formats land near 600 KB for the whole page —
  cheaper than the 4 MB the superseded authored loop budgeted for one.
This is why clips beat GIFs: the same five seconds as a GIF at this size runs to
  several megabytes, and GIF cannot hold the palette's gradients without banding.

## Page structure

Sections, top to bottom:

1. **Hero** — the headline already in the dictionary (`landing.h1a` / `landing.h1b`),
     the subhead, and the strongest gameplay clip playing behind or beside it.
2. **How it works** — three steps: create a room, send the link, deal.
     Mirrors what the product actually does; no signup step to explain because there is none.
3. **House rules** — the four toggles, `title` + `tagline` straight from `RULES_CATALOG`,
     so the landing and the game can never drift apart.
     This is the section that overlaps sub-project E; the prose is written once.
4. **See it** — the remaining clips, captioned by what they show.
5. **Close** — a last full-width call to action.

### The fixed call to action

The create/join controls are pinned to the viewport rather than parked in the hero.
A visitor who has scrolled to the rules and decided is one tap from a room —
  they never have to scroll back to act.

Consequences to handle:

- On mobile it becomes a bottom bar; keep it clear of the home indicator and never let it
    cover a clip's caption.
- It must not double up: when the hero's own buttons are on screen, the pinned bar stays out.
- The join field's PIN step and the code input keep working inside it.
- It stays reachable by keyboard tab order and does not trap focus.

### Scroll animation

Sections animate in as they enter the viewport — the intent is life, not spectacle.
Constraints:

- Driven by `IntersectionObserver`, not by a scroll handler firing on every frame.
- Every animated property is `transform` or `opacity`, so nothing triggers layout.
- Clips only play while on screen and pause when scrolled past — four autoplaying
    videos at once is wasted battery.
- `prefers-reduced-motion: reduce` disables the section animations and swaps every clip
    for its poster frame.

## Clips to cut

Chosen for what they prove, one moment each, 3–6 seconds, silent, seamless enough to loop:

| Clip | Shows |
|---|---|
| A turn | The basic loop — pick a card, it lands, play passes on |
| A rank stack | `multiDiscard`: several cards of one value going down together |
| A penalty | The +4 slam and the pot riding on under `stacking` |
| The last card | The call, and a hand emptying |

Exact timestamps come from a pass over the recording during implementation;
  the frame at 78 s (a called green, a hand down to two) is already a candidate for the hero.

The transcode is scripted, not hand-run — a `tools/` script taking in-points and durations,
  so re-cutting after a redesign is one command.
Poster frames are extracted from frame 0 of each clip, so a paused or unloaded video is
  indistinguishable from a playing one.

## Sound

Quiet UI sounds only. Nothing plays before the visitor's first gesture — browsers block it
  and it would be rude regardless.

- Two or three samples: a card whisper on hover over the primary button, a firmer one on
    create-room, nothing else.
- A visible mute control, its state persisted, off-by-default respected on return visits.
- Landing sound is **not** the background music: `sound.mp3` belongs to sub-project C and
    starts inside the game.

## Out of scope

The authored hero loop (superseded), the in-game rules slide and help (sub-project E,
  though it shares the catalog prose), background music (C), metrics and podium (D),
  deploy and the security audit (F).
No blog, no pricing, no testimonials — there is nothing to charge for and no one to quote.

## Open questions

- Which four moments, by timestamp, once someone has watched the recording end to end.
- Whether the hero clip is full-bleed behind the copy or framed beside it —
    the recording is square, which suits a frame better than a 16:9 bleed.
- Whether the landing keeps the language switcher in the header (it exists) or moves it
    into the fixed bar.
