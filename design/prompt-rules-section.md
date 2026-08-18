# Prompt for Claude Design — add the "Rules of the game" section

Date: 2026-08-18. Paste the block below into Claude Design, working on
`Ochre Eights - Landing Page.dc.html`. Everything after the rule is the prompt.

---

Edit `Ochre Eights - Landing Page.dc.html`.

## 1. Add a new section: Rules of the game

Place it **after "See it"** and before the closing orange CTA section. Give it
`data-screen-label="Rules of the game"` and the same scroll-reveal treatment the
other sections use (`IntersectionObserver`, opacity + 22px translateY, `.7s ease`,
already frozen open under `prefers-reduced-motion`).

Heading: **How the game plays**
Standfirst: *Ten seconds of reading and you can sit down at any table.*

Six cards in a responsive grid — `repeat(auto-fit, minmax(300px, 1fr))`, so it
settles into 3×2 on desktop and one column on a phone. Each card carries, top to
bottom:

1. **An animated situation on the table** — a small stage, roughly 16:10, showing
   the rule happening with real card shapes.
2. **A title** (display face, ~21px).
3. **A one-line tagline** (the bold summary).
4. **A short explanation** (~15px, muted, 2–4 lines).

Card shell: `#fffdf8`, 1px border `rgba(32,30,29,.14)`, radius 16px — matching the
House rules cards already on the page. The stage sits inside on the felt tone
`#dfe6cd` with the same diagonal hatch used elsewhere.

### The animations are CSS, not video and not GIF

Draw the cards as markup — rounded rectangles with the suit colour, a cream oval, a
numeral or a glyph — and move them with CSS keyframes. No video files, no image
assets, no JS animation loop.

Reasons this matters: it weighs nothing, it stays sharp at any size, it can be
restyled later without re-recording anything, and the palette holds exactly.

Every loop runs 4–6 seconds, pauses about a second at rest, and loops seamlessly.
Under `prefers-reduced-motion: reduce` each one freezes at its most legible frame —
the moment the rule is clearest — rather than stopping wherever it happened to be.

Palette, verbatim: card red `#c23b2e`, yellow `#e0a020`, green `#66923f`,
blue `#2e6f8a`, wild `#6b5f4a`, card cream `#f7eddc`, back `#2a2621`,
felt `#dfe6cd`, ink `#201e1d`, accent `#c67139`.

### The six cards

Use this copy exactly. It is the same prose the game itself shows, and the two must
not fork.

**1 — Making a move**
Tagline: *Match the colour, the number, or the symbol.*
Body: Your card goes on top if it matches in at least one way: colour, number, or
action symbol. A red 7 covers any red card and any seven. Wilds always fit.
Animation: a red 7 rests on the discard. Three cards rise from the hand in turn and
settle onto it — a red 3, a blue 7, a red skip — each pausing long enough to read,
with the matching attribute (the colour bar, the numeral) briefly ringed.

**2 — Action cards**
Tagline: *Skip, Reverse and Draw 2 — one of each in every colour.*
Body: Skip takes the next player's turn away. Reverse flips the direction of play —
and with two players it acts as a Skip, handing the turn straight back to you.
Draw 2 makes the next player take two cards and lose their turn.
Animation: three beats in one loop. A skip lands and the next seat dims with a
struck-through ring. A reverse lands and the direction arrow around the table
swings the other way. A draw-two lands and two card backs arc into the next seat.

**3 — Wilds**
Tagline: *Always playable, and you call the colour.*
Body: A wild can go down at any point on your turn, and playing it lets you name
the colour play continues in. A Wild Draw 4 also makes the next player take four
cards and lose their turn. There is no challenge.
Animation: a wild card lands on a mismatched pile. Four colour dots fan out above
it; one is chosen, and the felt washes to that colour the way the real table does.

**4 — When nothing fits**
Tagline: *Take a card — play it, or pass the turn.*
Body: With nothing playable, take one card from the pile. If it fits you may play
it right away; if it does not, or you would rather keep it, the turn passes. When
the pile runs out, the discard minus its top card is shuffled back.
Animation: a hand of three sits with nothing matching the discard — each card
shakes a little in refusal. One card slides off the draw pile; it either continues
onto the discard, or tucks into the hand while the turn arrow moves on. Show both
outcomes across the loop.

**5 — The last card**
Tagline: *Call it on your last card, or get caught for two.*
Body: Playing your second-to-last card opens a window: press "last card", either
just before or right after the play. Until the next player acts, anyone at the
table may catch you, and a catch costs you two cards. Call in time and there is
nothing to catch.
Animation: a hand drops from two cards to one. A "LAST CARD" badge pulses over the
seat while a ring closes around it like a timer. Play it twice in the loop: once
called in time and the ring fades safely, once missed — the ring completes, a
"CAUGHT" flash, two cards fly back into the hand.

**6 — How a round opens**
Tagline: *A round always opens on a number card.*
Body: Dealing is its own step before the round: the deck is shuffled, everyone gets
seven, and then cards are turned over until a number appears. Anything else goes to
the bottom of the pile and stays in play. Nobody is penalised or skipped before they
have played a card. Official UNO differs here — there a flipped action card takes
effect on the starting player.
Animation: cards flip off the top of the deck one at a time. A skip turns up and
slides under the pile; a wild turns up and slides under; then a green 5 turns up and
stays, and the table settles around it.

Mark this card visually as the one that departs from the rules people know — a small
accent-coloured tag reading **Our rule**, or similar. It is the thing a UNO veteran
will otherwise read as a bug.

## 2. Fix three things that are wrong against the product

While you are in the file:

**The four house rules are not the right four.** The section currently lists
Stacking, Jump-in, Draw to match, and Catch the last card. Jump-in was considered
and rejected, and catching the last card is a base rule that is always on, not a
host switch. Replace the catalog with the actual four, copy verbatim:

| Title | Tagline |
|---|---|
| Pass the penalty | +2 answers +2, +4 answers +4 — the pot rides on. |
| Force play | A drawn playable card goes straight down. |
| Draw to match | No play? Draw until something plays. |
| Stack discard | Same number, any colors — throw them together. |

**The table seats two to four, not two to ten.** Fix both places: the line under the
hero buttons ("No account. No install. Two to ten seats.") and step 3 of How it
works ("Seven cards each, two to ten seats.").

**"Chase the eights" promises a mechanic that does not exist.** Eights are only in
the name. Reword that clause of the hero subhead — the rest of the line is good.

## 3. Leave alone

The hero, the pinned join bar and its code → PIN flow, the scroll reveals, the
language switch, and the mute control are all settled. Do not restructure them.

Keep the page near its current media weight: the new section adds no files.
