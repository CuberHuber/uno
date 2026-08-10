# Ochre Eights — online UNO-style card game (design spec)

Date: 2026-08-10.
Status: approved pending user review.

## Summary

A web app for playing a classical UNO-style card game with friends in private rooms.
A host creates a room and shares an auto-generated link (or short token);
  2–4 players join with a display name, no accounts.
The game follows official classic UNO rules, one round at a time, with rematch.
The visual identity is **Ochre Eights** — the trademark-safe brand and warm "Organic"
  design system the user created in Claude Design (imported under `design/`),
  direction **1a Sunroom** (light cream ground, felt oval table).
It works on laptop and mobile browsers.

## Decision log

These decisions were made during brainstorming and supersede earlier drafts where noted.

| Topic | Decision |
|---|---|
| Game format | Single round; first to empty their hand wins; rematch keeps seats and a win tally |
| Rules depth | Official classic rules; "last card" call button with catch penalty; no Wild Draw 4 challenge |
| House rules | None — no stacking, no jump-in, no force-play, no configurable toggles |
| Turn timer | None |
| Disconnects | Seat held, game pauses; rejoin via same link restores the hand; after 2 minutes others may continue without the player |
| Visual design | Ochre Eights / Organic DS, direction 1a Sunroom (supersedes "classical UNO design" from the original brief) |
| Richer designed ruleset | Rejected — the design's house-rule toggles, best-of-5 scoring, 0:12 turn timer, and 45 s knock-out flow are **not** implemented; the imported design is the visual skin |
| Architecture | TypeScript monolith: Node + Fastify + Socket.IO server, React + Vite client, shared types package |
| Hosting | One always-on container (Fly.io or equivalent); rooms in server memory; no database |

## Architecture

Monorepo with npm workspaces:

```
uno/
├── server/    Node 22 + TypeScript, Fastify + Socket.IO; serves the built client
├── client/    React 19 + Vite + TypeScript single-page app
├── shared/    Protocol types and pure helpers used by both sides
└── design/    Imported Claude Design reference (Ochre Eights, Organic DS) — not shipped
```

The server is authoritative.
It owns the deck, hands, and turn logic, validates every move,
  and sends each player a personalized view: their own cards plus card *counts* for opponents.
Clients never receive other players' hands, so cheating via devtools is structurally impossible.

The client is a thin renderer.
It displays the latest server view and sends intents
  (play card, draw, call last card, catch, rematch).
Its only game logic is `isPlayable(card, topCard, currentColor)` from `shared/`,
  used to highlight legal cards.

State lives in a `Map<roomId, Room>` in server memory.
One HTTP endpoint creates a room and returns its link and token;
  everything else flows over Socket.IO.
Rooms are garbage-collected when empty for 10 minutes or after 24 hours of life.
A server restart drops active games; this is accepted for a pet project.

## Game rules (engine)

The engine is a pure reducer: `applyAction(state, action) → newState` or a typed rejection.
Shuffle randomness is injected (seedable) so every rule is unit-testable.

Deck: 108 cards.
Per color (four colors): one 0, two each of 1–9, two Skip, two Reverse, two Draw 2;
  plus four Wild and four Wild Draw 4.

- Cards match by color, number, or symbol; Wilds are always playable.
- Skip skips the next player; Draw 2 makes the next player draw two and lose the turn.
- Reverse flips direction; in a 2-player game it acts as Skip.
- Wild and Wild Draw 4 carry the chosen color in the same `playCard` action;
    Wild Draw 4 makes the next player draw four and lose the turn (no challenge).
- A player who cannot or will not play draws exactly one card;
    if it is playable they may play it immediately, otherwise the turn passes.
- First discard flip: action cards take effect on the starting player;
    a flipped Wild lets the starting player choose the color;
    a flipped Wild Draw 4 is shuffled back and re-flipped.
- When the draw pile empties, the discard pile minus its top card is reshuffled.
- Last-card call: playing the second-to-last card arms a catch window.
  The player presses **Call "last card"** (before or immediately after playing) to be safe.
  Until the next player acts, any opponent may press **Catch** to make them draw two.
- The round ends the instant a player plays their last card.
  Any player may then trigger a rematch: same seats, fresh shuffle, win tally incremented.

## Rooms, identity, reconnection

Room lifecycle: `Lobby → Playing → RoundEnd → (rematch) → Playing`.
The host creates the room, gets a short room code rendered as link and token
  (`https://…/r/4K2P-9XVB`), and shares it.
Joiners enter a display name and take a seat (max 4).
The host starts the game once 2+ players are seated; the room then stops accepting joins.

On first join the server issues a random `playerToken`,
  which the client stores in localStorage keyed by room.
Reopening the link sends the token, the server matches the held seat,
  re-sends the personalized state, and the game resumes.

Any disconnect pauses the game ("waiting for X…").
After 2 minutes the remaining players see **Continue without them**,
  which removes the seat and buries the absent player's cards at the bottom of the draw pile.
If only one player remains, the round ends in their favor.

## Realtime protocol

Client → server: `joinRoom`, `startGame`, `playCard`, `drawCard`,
  `callLastCard`, `catchLastCard`, `rematch`, `continueWithout`.
Server → client: `roomState` (the full personalized view, re-sent on every change),
  `moveRejected` (transient, for invalid attempts),
  and `effect` (animation cues: who drew, what was played).
Full-state broadcast is deliberate: a 4-player view is a few hundred bytes,
  so delta updates are not worth their complexity.

## UI

Brand and look come from the imported design:
  `design/Card Room UI.dc.html` (direction **1a Sunroom**),
  `design/Ochre Eights - Animated Table.dc.html` (motion reference),
  and the Organic design system under `design/_ds/…`
  (tokens in `styles.css`; usage guide in `readme.md`).
Client styling consumes the DS tokens (`--color-*`, `--font-*`, `--space-*`,
  `--radius-*`, `--shadow-*`); no hard-coded hex, font, or px values the tokens carry.

Screens (six, adapted from the design's nine by dropping house-rule toggles,
  spectator/knock-out states, and all timers):

1. **Landing** — Ochre Eights mark, *Create a room* / *I have an invite*.
2. **Host link** — invite link and token with *Copy*, then *Open the room*.
3. **Join** — token paste (or direct link arrival), "Table found" confirmation,
     name entry, *Take a seat*.
4. **Lobby** — seat list with host badge, *Copy invite*,
     host-only *Deal the first hand* enabled at 2+ players.
5. **Table** — felt oval with opponents seated around it (top/left/right),
     center stage with draw pile, discard, and the "X is live · whose turn" banner,
     fanned hand at the bottom, *Draw* and *Call "last card"* buttons,
     playable cards highlighted, current player ringed.
   Mobile uses the design's compact stacked layout (screen 09) without the timer chip.
6. **Round over** — "X takes it", cards left per player, room win tally,
     *Play again* / *Leave*.

Plus two states rather than screens:
  **Reconnecting** ("your seat is held", pause overlay for others)
  and **Table not found** for dead links.

Card faces follow the animated-table reference:
  rounded rectangles in the four muted suit colors with the rotated cream oval
  and Caprasimo glyphs; card backs use the terracotta "8" mark.

## Error handling

- Invalid moves: rejected server-side; the client shows a brief shake and stays in sync
    because the server view is always authoritative.
- Unknown or expired room: "table not found" screen with a path back to the landing page.
- Socket drop: automatic reconnect (Socket.IO backoff) with the stored seat token;
    within the grace window this is seamless.
- Server restart: rooms are lost; players create a new room.

## Testing

The rules engine carries the real coverage:
  unit tests on the pure reducer with seeded decks covering every card effect,
  the 2-player Reverse, first-flip handling, reshuffle,
  the last-card call and catch window, and deck-exhaustion edge cases.
The socket layer gets one integration test where two simulated clients
  play a scripted round against a real server instance.
UI is verified manually; no E2E suite for a pet project.

## Deployment

One Dockerfile: build the client, copy the static output into the server,
  run the Node process.
Deploy to Fly.io, Railway, or Render (hobby tier) — a single instance,
  which the in-memory state model requires.
`design/` ships in the repository as reference, not in the container image.

## Out of scope

Accounts, persistence, databases, spectators, bots, turn timers,
  house rules, scoring across rounds, horizontal scaling,
  native apps, and the Wild Draw 4 challenge.
