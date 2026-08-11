# Ochre Eights

An online UNO-style card game for playing with friends in private rooms.
A host creates a room, shares an auto-generated link, and 2–4 players
  play a classic round right in the browser — laptop or mobile, no accounts.

**Status:** playable. `npm install && npm run build && npm start -w server`,
  then open http://localhost:3000. For development: `npm run dev -w server`
  and `npm run dev -w client` (Vite on :5173 proxies to :3000).

## What's here

- [`docs/superpowers/specs/2026-08-10-uno-online-design.md`](docs/superpowers/specs/2026-08-10-uno-online-design.md) —
    the approved design spec: rules, architecture, protocol, screens.
- [`design/`](design/) — the visual reference imported from Claude Design:
    the Ochre Eights brand, the "Organic" design system (tokens + usage guide),
    and mockups of every screen (direction *1a Sunroom*).

## Planned stack

TypeScript monolith: a Node + Fastify + Socket.IO server (authoritative game state,
  rooms in memory, no database) serving a React + Vite single-page client,
  with a shared types package between them.
One container, deployable to any small always-on host.

## Rules in one breath

Official classic rules: match by color, number, or symbol; Skip, Reverse, Draw 2,
  Wild, and Wild Draw 4; draw one if you can't play; call **"last card"** before
  your final card or get caught for two.
First to empty their hand takes the round; rematch keeps the seats and the tally.
