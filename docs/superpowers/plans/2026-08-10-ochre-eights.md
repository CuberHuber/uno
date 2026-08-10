# Ochre Eights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Ochre Eights online UNO-style card game per `docs/superpowers/specs/2026-08-10-uno-online-design.md`: private rooms by generated link, 2–4 players, official classic rules, single round + rematch, Sunroom visual direction.

**Architecture:** TypeScript monorepo (npm workspaces). An authoritative Node server (Fastify + Socket.IO) holds all game state in memory as a pure-reducer engine and broadcasts personalized views; a React + Vite SPA renders those views and sends intents. One deployable container.

**Tech Stack:** Node 22, TypeScript (strict), Fastify 5, Socket.IO 4, React 19, Vite 6, Vitest for all tests.

## Global Constraints

- Node 22, `"type": "module"` everywhere, TypeScript `strict: true`.
- npm workspaces: `shared/`, `server/`, `client/`; package names `@uno/shared`, `@uno/server`, `@uno/client`.
- Server is authoritative: clients never receive another player's cards.
- Protocol event names exactly: `joinRoom`, `startGame`, `playCard`, `drawCard`, `passTurn`, `chooseColor`, `callLastCard`, `catchLastCard`, `rematch`, `continueWithout` (client→server); `roomState`, `moveRejected`, `effect` (server→client). (`passTurn`/`chooseColor` added by user ruling 2026-08-10 — required by the draw-one play-or-keep and first-flip-Wild rules.)
- Brand copy: game name **Ochre Eights**; buttons **Draw**, **Call “last card”**, **Catch**; banner pattern “\<Color\> is live · \<name\>’s turn”.
- Visual: consume Organic DS tokens (`--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`) from the vendored stylesheet; suit colors are new tokens `--card-red #c25f4e`, `--card-blue #5c86a8`, `--card-yellow #d9a441`, `--card-green #7f9a5c`, `--card-back #b2622d`, `--card-cream #fdf8ef` (from `design/Ochre Eights - Animated Table.dc.html`).
- No accounts, no database, no turn timers, no house rules, no Wild Draw 4 challenge, no spectators.
- Room codes: 8 chars from Crockford alphabet `23456789ABCDEFGHJKMNPQRSTVWXYZ`, rendered `XXXX-XXXX`.
- Tests: Vitest; engine and room tests are mandatory TDD; UI is verified manually (spec decision — no E2E).
- Commit after every task (conventional commits).

## File Structure

```
uno/
├── package.json                    # workspaces root; build/test scripts
├── tsconfig.base.json
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                # re-exports
│       ├── types.ts                # Card, Color, Value, RoomStateView, socket event maps
│       └── cards.ts                # isPlayable()
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── engine/
│   │   │   ├── deck.ts             # buildDeck(), rng(), shuffle()
│   │   │   ├── game.ts             # GameState, Action, createGame(), applyAction()
│   │   │   └── views.ts            # projectView() — personalized RoomStateView
│   │   ├── rooms.ts                # Room, RoomStore: create/join/start/rematch/remove/GC
│   │   ├── sockets.ts              # Socket.IO wiring, broadcast, reconnection
│   │   └── server.ts               # Fastify: POST /api/rooms, static client, boot
│   └── test/
│       ├── deck.test.ts
│       ├── game-setup.test.ts
│       ├── game-play.test.ts
│       ├── game-wild.test.ts
│       ├── game-draw.test.ts
│       ├── game-lastcard.test.ts
│       ├── views.test.ts
│       ├── rooms.test.ts
│       └── integration.test.ts     # two socket.io clients play a full round
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 # screen router (URL + server phase)
│       ├── socket.ts               # typed socket singleton + intent helpers
│       ├── store.tsx               # React context fed by roomState/effect events
│       ├── ds.css                  # vendored Organic DS stylesheet (copied from design/)
│       ├── game.css                # felt table, cards, layout, mobile breakpoint
│       ├── components/
│       │   ├── CardFace.tsx        # one card (face or back), any size
│       │   ├── Seat.tsx            # opponent pill + card fan
│       │   └── ColorPicker.tsx     # wild color chooser dialog
│       └── screens/
│           ├── Landing.tsx
│           ├── HostLink.tsx
│           ├── Join.tsx
│           ├── Lobby.tsx
│           ├── Table.tsx
│           └── RoundOver.tsx
├── Dockerfile
└── fly.toml                        # deploy config (Fly.io)
```

Data flow: `sockets.ts` receives an intent → `RoomStore` looks up the room → `applyAction()` returns new `GameState` + effects → `projectView()` per seat → `roomState` emitted to each connected socket. The client never mutates game state locally.

---

### Task 1: Monorepo scaffold and shared package (`isPlayable`)

**Files:**
- Create: `package.json`, `tsconfig.base.json`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/{index,types,cards}.ts`
- Test: `shared/test/cards.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `@uno/shared` exporting `Color`, `Value`, `Card`, `Phase`, `SeatView`, `RoomStateView`, `ClientToServerEvents`, `ServerToClientEvents`, `Effect`, and `isPlayable(card: Card, top: Card, currentColor: Color | null): boolean`. Every later task imports from here.

- [ ] **Step 1: Root scaffolding**

Root `package.json`:

```json
{
  "name": "uno",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "build": "npm run build -w shared -w client -w server && rm -rf server/public && cp -r client/dist server/public",
    "test": "npm test -w shared -w server",
    "typecheck": "tsc -b shared server client"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "composite": true,
    "declaration": true,
    "skipLibCheck": true
  }
}
```

`shared/package.json`:

```json
{
  "name": "@uno/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

Run: `npm install` at the repo root.

- [ ] **Step 2: Write the shared types (no test needed — types only)**

`shared/src/types.ts`:

```ts
export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Value =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: number;
  color: Color | null; // null for wild / wild4
  value: Value;
}

export type Phase = 'lobby' | 'playing' | 'roundEnd';

export interface SeatView {
  seat: number;
  name: string;
  cardCount: number;
  connected: boolean;
  calledLastCard: boolean;
  isHost: boolean;
}

export interface RoomStateView {
  roomCode: string;
  phase: Phase;
  yourSeat: number;
  hand: Card[];
  seats: SeatView[];
  turnSeat: number | null;
  direction: 1 | -1;
  topCard: Card | null;
  currentColor: Color | null;
  mustChooseColor: boolean;      // you flipped/played a positional wild start; pick color first
  pendingDrawnCardId: number | null; // you drew a playable card: play it or pass
  catchableSeat: number | null;  // catch window is open on this seat
  drawPileCount: number;
  winnerSeat: number | null;
  winTally: number[];
  paused: boolean;
  pausedForName: string | null;
  pausedSinceMs: number | null;  // server epoch ms; client derives the 2-minute mark
}

export type Effect =
  | { type: 'played'; seat: number; card: Card }
  | { type: 'drew'; seat: number; count: number }
  | { type: 'called'; seat: number }
  | { type: 'caught'; seat: number }
  | { type: 'win'; seat: number };

export interface JoinAck {
  ok: boolean;
  error?: string;
  seat?: number;
  token?: string;
  roomName?: string;
}

export interface ClientToServerEvents {
  joinRoom: (
    p: { code: string; name?: string; token?: string },
    ack: (r: JoinAck) => void
  ) => void;
  startGame: () => void;
  playCard: (p: { cardId: number; chosenColor?: Color }) => void;
  drawCard: () => void;
  passTurn: () => void;          // decline to play a drawn playable card
  chooseColor: (p: { color: Color }) => void; // first-flip wild
  callLastCard: () => void;
  catchLastCard: () => void;
  rematch: () => void;
  continueWithout: (p: { seat: number }) => void;
}

export interface ServerToClientEvents {
  roomState: (view: RoomStateView) => void;
  moveRejected: (p: { reason: string }) => void;
  effect: (e: Effect) => void;
}
```

`shared/src/index.ts`:

```ts
export * from './types.js';
export * from './cards.js';
```

- [ ] **Step 3: Write the failing test for `isPlayable`**

`shared/test/cards.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { isPlayable, type Card } from '../src/index.js';

const c = (color: Card['color'], value: Card['value'], id = 1): Card => ({ id, color, value });

describe('isPlayable', () => {
  const topRed7 = c('red', '7');

  test('same color matches', () => {
    expect(isPlayable(c('red', '3'), topRed7, 'red')).toBe(true);
  });
  test('same value different color matches', () => {
    expect(isPlayable(c('blue', '7'), topRed7, 'red')).toBe(true);
  });
  test('different color and value does not match', () => {
    expect(isPlayable(c('blue', '3'), topRed7, 'red')).toBe(false);
  });
  test('wild and wild4 always playable', () => {
    expect(isPlayable(c(null, 'wild'), topRed7, 'red')).toBe(true);
    expect(isPlayable(c(null, 'wild4'), topRed7, 'red')).toBe(true);
  });
  test('matches currentColor, not printed top color (after a wild)', () => {
    const topWild = c(null, 'wild');
    expect(isPlayable(c('green', '2'), topWild, 'green')).toBe(true);
    expect(isPlayable(c('red', '2'), topWild, 'green')).toBe(false);
  });
  test('symbol matches symbol across colors', () => {
    expect(isPlayable(c('blue', 'skip'), c('red', 'skip'), 'red')).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — `isPlayable` is not exported.

- [ ] **Step 5: Implement `isPlayable`**

`shared/src/cards.ts`:

```ts
import type { Card, Color } from './types.js';

export function isPlayable(card: Card, top: Card, currentColor: Color | null): boolean {
  if (card.value === 'wild' || card.value === 'wild4') return true;
  if (currentColor === null) return true; // pre-color-choice; server blocks plays until chosen
  if (card.color === currentColor) return true;
  return card.value === top.value;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json shared/
git commit -m "feat: monorepo scaffold and shared types with isPlayable"
```

---

### Task 2: Deck construction and seeded shuffle

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/engine/deck.ts`
- Test: `server/test/deck.test.ts`

**Interfaces:**
- Consumes: `Card`, `Color`, `Value` from `@uno/shared`.
- Produces: `buildDeck(): Card[]` (108 cards, unique ids 0–107), `rng(seed: number): () => number` (mulberry32), `shuffle<T>(items: T[], random: () => number): T[]` (pure Fisher–Yates copy).

- [ ] **Step 1: Server package scaffolding**

`server/package.json`:

```json
{
  "name": "@uno/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@uno/shared": "*",
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "socket.io": "^4.8.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "socket.io-client": "^4.8.0"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

Run: `npm install` at root.

- [ ] **Step 2: Write the failing tests**

`server/test/deck.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildDeck, rng, shuffle } from '../src/engine/deck.js';

describe('buildDeck', () => {
  const deck = buildDeck();

  test('has exactly 108 cards with unique ids', () => {
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });
  test('per color: one 0, two of each 1-9, two skip/reverse/draw2', () => {
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      const of = (v: string) => deck.filter((c) => c.color === color && c.value === v).length;
      expect(of('0')).toBe(1);
      for (let n = 1; n <= 9; n++) expect(of(String(n))).toBe(2);
      expect(of('skip')).toBe(2);
      expect(of('reverse')).toBe(2);
      expect(of('draw2')).toBe(2);
    }
  });
  test('four wilds and four wild4s, colorless', () => {
    expect(deck.filter((c) => c.value === 'wild' && c.color === null)).toHaveLength(4);
    expect(deck.filter((c) => c.value === 'wild4' && c.color === null)).toHaveLength(4);
  });
});

describe('shuffle', () => {
  test('same seed gives same order; different seed differs', () => {
    const a = shuffle(buildDeck(), rng(42)).map((c) => c.id);
    const b = shuffle(buildDeck(), rng(42)).map((c) => c.id);
    const c = shuffle(buildDeck(), rng(7)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  test('does not mutate input and keeps all cards', () => {
    const deck = buildDeck();
    const before = deck.map((c) => c.id);
    const out = shuffle(deck, rng(1));
    expect(deck.map((c) => c.id)).toEqual(before);
    expect([...out.map((c) => c.id)].sort((x, y) => x - y)).toEqual(before);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — module `../src/engine/deck.js` not found.

- [ ] **Step 4: Implement deck.ts**

`server/src/engine/deck.ts`:

```ts
import type { Card, Color, Value } from '@uno/shared';

const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const color of COLORS) {
    cards.push({ id: id++, color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      const v = String(n) as Value;
      cards.push({ id: id++, color, value: v });
      cards.push({ id: id++, color, value: v });
    }
    for (const v of ['skip', 'reverse', 'draw2'] as const) {
      cards.push({ id: id++, color, value: v });
      cards.push({ id: id++, color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild' });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild4' });
  return cards;
}

/** mulberry32 — small deterministic PRNG, good enough for card shuffling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat: 108-card deck with seeded shuffle"
```

---

### Task 3: Game creation — deal and first flip

**Files:**
- Create: `server/src/engine/game.ts` (state types + `createGame` only; `applyAction` comes in Task 4)
- Test: `server/test/game-setup.test.ts`

**Interfaces:**
- Consumes: `buildDeck`, `shuffle`, `rng` from Task 2; `Card`, `Color` from `@uno/shared`.
- Produces:

```ts
export interface PlayerState { hand: Card[]; calledLastCard: boolean; removed: boolean }
export interface GameState {
  players: PlayerState[];           // index = seat
  drawPile: Card[];                 // top of pile = last element
  discard: Card[];                  // top of discard = last element
  turn: number;
  direction: 1 | -1;
  currentColor: Color | null;       // null only while mustChooseColor
  mustChooseColor: boolean;
  pendingDrawn: { seat: number; cardId: number } | null;
  catchWindow: { seat: number } | null;
  winner: number | null;
  reshuffleSeed: number; // advances on every discard reshuffle for determinism
}
export function createGame(numPlayers: number, random: () => number): GameState;
export function nextSeat(state: GameState, from: number, steps?: number): number;
```

- [ ] **Step 1: Write the failing tests**

`server/test/game-setup.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createGame, nextSeat } from '../src/engine/game.js';
import { rng } from '../src/engine/deck.js';

function findSeed(pred: (g: ReturnType<typeof createGame>) => boolean, players = 3): number {
  for (let seed = 0; seed < 5000; seed++) {
    if (pred(createGame(players, rng(seed)))) return seed;
  }
  throw new Error('no seed found');
}

describe('createGame', () => {
  test('deals 7 cards to each player and flips one discard', () => {
    const g = createGame(4, rng(1));
    expect(g.players).toHaveLength(4);
    for (const p of g.players) expect(p.hand.length).toBeGreaterThanOrEqual(7);
    expect(g.discard).toHaveLength(1);
    expect(g.drawPile.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0)).toBe(108);
  });

  test('first flip is never wild4', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(createGame(3, rng(seed)).discard[0]!.value).not.toBe('wild4');
    }
  });

  test('number flip: seat 0 starts, color = card color', () => {
    const seed = findSeed((g) => /^[0-9]$/.test(g.discard[0]!.value));
    const g = createGame(3, rng(seed));
    expect(g.turn).toBe(0);
    expect(g.currentColor).toBe(g.discard[0]!.color);
    expect(g.mustChooseColor).toBe(false);
  });

  test('skip flip: seat 0 is skipped, seat 1 starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'skip');
    expect(createGame(3, rng(seed)).turn).toBe(1);
  });

  test('draw2 flip: seat 0 draws two (9 cards) and seat 1 starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'draw2');
    const g = createGame(3, rng(seed));
    expect(g.players[0]!.hand).toHaveLength(9);
    expect(g.turn).toBe(1);
  });

  test('reverse flip: direction flips and last seat starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'reverse');
    const g = createGame(3, rng(seed));
    expect(g.direction).toBe(-1);
    expect(g.turn).toBe(2);
  });

  test('wild flip: seat 0 must choose color before anything else', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'wild');
    const g = createGame(3, rng(seed));
    expect(g.turn).toBe(0);
    expect(g.currentColor).toBeNull();
    expect(g.mustChooseColor).toBe(true);
  });
});

describe('nextSeat', () => {
  test('wraps forward and backward', () => {
    const g = createGame(3, rng(1));
    expect(nextSeat({ ...g, direction: 1 }, 2)).toBe(0);
    expect(nextSeat({ ...g, direction: -1 }, 0)).toBe(2);
    expect(nextSeat({ ...g, direction: 1 }, 0, 2)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `game.js` not found.

- [ ] **Step 3: Implement state types and createGame**

`server/src/engine/game.ts`:

```ts
import type { Card, Color } from '@uno/shared';
import { buildDeck, shuffle } from './deck.js';

export interface PlayerState { hand: Card[]; calledLastCard: boolean; removed: boolean }

export interface GameState {
  players: PlayerState[];
  drawPile: Card[];
  discard: Card[];
  turn: number;
  direction: 1 | -1;
  currentColor: Color | null;
  mustChooseColor: boolean;
  pendingDrawn: { seat: number; cardId: number } | null;
  catchWindow: { seat: number } | null;
  winner: number | null;
  reshuffleSeed: number; // advances on every discard reshuffle for determinism
}

export function nextSeat(state: GameState, from: number, steps = 1): number {
  const n = state.players.length;
  let seat = from;
  for (let remaining = steps; remaining > 0; remaining--) {
    do {
      seat = (((seat + state.direction) % n) + n) % n;
    } while (state.players[seat]!.removed);
  }
  return seat;
}

export function createGame(numPlayers: number, random: () => number): GameState {
  const drawPile = shuffle(buildDeck(), random);
  const players: PlayerState[] = Array.from({ length: numPlayers }, () => ({
    hand: [], calledLastCard: false, removed: false,
  }));
  for (let round = 0; round < 7; round++) {
    for (const p of players) p.hand.push(drawPile.pop()!);
  }

  // Flip the first discard; a wild4 is buried and the next card flipped instead.
  let first = drawPile.pop()!;
  while (first.value === 'wild4') {
    drawPile.unshift(first);
    first = drawPile.pop()!;
  }

  const state: GameState = {
    players, drawPile, discard: [first],
    turn: 0, direction: 1,
    currentColor: first.color,
    mustChooseColor: false,
    pendingDrawn: null, catchWindow: null, winner: null,
    reshuffleSeed: Math.floor(random() * 2 ** 31),
  };

  switch (first.value) {
    case 'skip':
      state.turn = nextSeat(state, 0);
      break;
    case 'reverse':
      state.direction = -1;
      state.turn = nextSeat({ ...state, direction: -1 }, 0);
      break;
    case 'draw2':
      state.players[0]!.hand.push(state.drawPile.pop()!, state.drawPile.pop()!);
      state.turn = nextSeat(state, 0);
      break;
    case 'wild':
      state.currentColor = null;
      state.mustChooseColor = true;
      break;
    default:
      break; // number card: seat 0 starts on the card's color
  }
  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/game.ts server/test/game-setup.test.ts
git commit -m "feat: game creation with dealing and first-flip rules"
```

---

### Task 4: Reducer — playing cards, card effects, winner detection

**Files:**
- Modify: `server/src/engine/game.ts` (add `Action`, `ActionResult`, `applyAction`, `drawFromPile`)
- Test: `server/test/game-play.test.ts`, `server/test/game-wild.test.ts`

**Interfaces:**
- Consumes: `GameState`, `createGame`, `nextSeat` (Task 3); `isPlayable`, `Effect` from `@uno/shared`.
- Produces:

```ts
export type Action =
  | { type: 'play'; seat: number; cardId: number; chosenColor?: Color }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number }
  | { type: 'chooseColor'; seat: number; color: Color }
  | { type: 'callLastCard'; seat: number }
  | { type: 'catchLastCard'; seat: number };

export type ActionResult =
  | { ok: true; state: GameState; effects: Effect[] }
  | { ok: false; error: string };

export function applyAction(state: GameState, action: Action): ActionResult;
```

`applyAction` never mutates its input (it `structuredClone`s). In this task the `draw`, `pass`, `callLastCard`, `catchLastCard` branches return `{ ok: false, error: 'not your turn' }`-style rejections only where validation fails naturally — their real logic lands in Tasks 5–6; this task implements `play` and `chooseColor` completely, plus the internal `drawFromPile(s, seat, count): number` helper (with discard reshuffle) that Tasks 5–6 reuse.

- [ ] **Step 1: Write the failing tests for plays and effects**

Test helper (top of `server/test/game-play.test.ts`) — builds a hand-crafted state so tests don't depend on shuffle luck:

```ts
import { describe, expect, test } from 'vitest';
import { applyAction, type GameState } from '../src/engine/game.js';
import type { Card } from '@uno/shared';

let nextId = 1000;
export const card = (color: Card['color'], value: Card['value']): Card =>
  ({ id: nextId++, color, value });

export function fixedState(hands: Card[][], top: Card, opts: Partial<GameState> = {}): GameState {
  return {
    players: hands.map((hand) => ({ hand, calledLastCard: false, removed: false })),
    drawPile: Array.from({ length: 20 }, () => card('green', '5')),
    discard: [top],
    turn: 0,
    direction: 1,
    currentColor: top.color,
    mustChooseColor: false,
    pendingDrawn: null,
    catchWindow: null,
    winner: null,
    reshuffleSeed: 1,
    ...opts,
  };
}

describe('play — validation', () => {
  test('rejects out-of-turn plays', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0], [card('red', '4')]], card('red', '7'), { turn: 1 });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    expect(r.ok).toBe(false);
  });
  test('rejects non-matching card', () => {
    const c0 = card('blue', '3');
    const s = fixedState([[c0], []], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(false);
  });
  test('rejects card not in hand and does not mutate input', () => {
    const s = fixedState([[card('red', '3')], []], card('red', '7'));
    const before = JSON.stringify(s);
    expect(applyAction(s, { type: 'play', seat: 0, cardId: 99999 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('play — number cards', () => {
  test('moves card to discard, sets color, advances turn', () => {
    const c0 = card('blue', '7');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(c0.id);
    expect(r.state.currentColor).toBe('blue');
    expect(r.state.turn).toBe(1);
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, card: c0 });
  });
});

describe('play — action cards', () => {
  test('skip jumps one player (3p)', () => {
    const c0 = card('red', 'skip');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(2);
  });
  test('reverse flips direction (3p)', () => {
    const c0 = card('red', 'reverse');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.direction).toBe(-1);
    expect(r.state.turn).toBe(2);
  });
  test('reverse acts as skip in 2p: same player goes again', () => {
    const c0 = card('red', 'reverse');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(0);
    expect(r.state.direction).toBe(1);
  });
  test('draw2: victim draws 2 and is skipped', () => {
    const c0 = card('red', 'draw2');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(3);
    expect(r.state.turn).toBe(2);
    expect(r.effects).toContainEqual({ type: 'drew', seat: 1, count: 2 });
  });
});

describe('play — winning', () => {
  test('playing the last card ends the round', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.winner).toBe(0);
    expect(r.effects).toContainEqual({ type: 'win', seat: 0 });
  });
  test('no actions accepted after the round ends', () => {
    const s = fixedState([[card('red', '3')], [card('green', '2')]], card('red', '7'), { winner: 1 });
    expect(applyAction(s, { type: 'draw', seat: 0 }).ok).toBe(false);
  });
});
```

`server/test/game-wild.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('wilds', () => {
  test('wild requires a chosen color and sets it', () => {
    const w = card(null, 'wild');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardId: w.id }).ok).toBe(false);
    const r = applyAction(s, { type: 'play', seat: 0, cardId: w.id, chosenColor: 'green' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.turn).toBe(1);
  });
  test('wild4: victim draws 4 and is skipped (no challenge)', () => {
    const w = card(null, 'wild4');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: w.id, chosenColor: 'blue' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(5);
    expect(r.state.turn).toBe(2);
    expect(r.state.currentColor).toBe('blue');
  });
});

describe('chooseColor (first-flip wild)', () => {
  test('resolves the pending choice; plays are blocked until then', () => {
    const c0 = card('red', '1');
    const s = fixedState([[c0], [card('green', '2')]], card(null, 'wild'), {
      currentColor: null, mustChooseColor: true,
    });
    expect(applyAction(s, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(false);
    const r = applyAction(s, { type: 'chooseColor', seat: 0, color: 'red' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('red');
    expect(r.state.mustChooseColor).toBe(false);
    expect(applyAction(r.state, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(true);
  });
  test('only the turn player may choose', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card(null, 'wild'), {
      currentColor: null, mustChooseColor: true,
    });
    expect(applyAction(s, { type: 'chooseColor', seat: 1, color: 'red' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `applyAction` is not exported.

- [ ] **Step 3: Implement applyAction (play + chooseColor) and drawFromPile**

Append to `server/src/engine/game.ts`:

```ts
import { isPlayable, type Effect } from '@uno/shared';
import { rng } from './deck.js';

export type Action =
  | { type: 'play'; seat: number; cardId: number; chosenColor?: Color }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number }
  | { type: 'chooseColor'; seat: number; color: Color }
  | { type: 'callLastCard'; seat: number }
  | { type: 'catchLastCard'; seat: number };

export type ActionResult =
  | { ok: true; state: GameState; effects: Effect[] }
  | { ok: false; error: string };

/** Draw `count` cards for `seat`, reshuffling the discard (minus its top) when
 *  the pile empties. Returns how many were actually drawn (both piles can run dry). */
function drawFromPile(s: GameState, seat: number, count: number): number {
  const p = s.players[seat]!;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0 && s.discard.length > 1) {
      const top = s.discard.pop()!;
      s.reshuffleSeed = (s.reshuffleSeed + 1) >>> 0;
      s.drawPile = shuffle(s.discard, rng(s.reshuffleSeed));
      s.discard = [top];
    }
    const card = s.drawPile.pop();
    if (!card) break;
    p.hand.push(card);
    drawn++;
  }
  if (p.hand.length > 1) p.calledLastCard = false;
  return drawn;
}

export function applyAction(state: GameState, action: Action): ActionResult {
  const s = structuredClone(state);
  const effects: Effect[] = [];
  const err = (error: string): ActionResult => ({ ok: false, error });

  if (s.winner !== null) return err('round is over');
  const player = s.players[action.seat];
  if (!player || player.removed) return err('bad seat');

  switch (action.type) {
    case 'chooseColor': {
      if (!s.mustChooseColor || s.turn !== action.seat) return err('no color choice pending');
      s.currentColor = action.color;
      s.mustChooseColor = false;
      return { ok: true, state: s, effects };
    }

    case 'play': {
      if (s.turn !== action.seat) return err('not your turn');
      if (s.mustChooseColor) return err('choose a color first');
      if (s.pendingDrawn && s.pendingDrawn.seat === action.seat && s.pendingDrawn.cardId !== action.cardId)
        return err('play the drawn card or pass');
      const idx = player.hand.findIndex((c) => c.id === action.cardId);
      if (idx === -1) return err('card not in hand');
      const card = player.hand[idx]!;
      const top = s.discard.at(-1)!;
      if (!isPlayable(card, top, s.currentColor)) return err('card does not match');
      const isWild = card.value === 'wild' || card.value === 'wild4';
      if (isWild && !action.chosenColor) return err('wild needs a color');

      s.catchWindow = null; // the next act closes any open window (may re-arm below)
      s.pendingDrawn = null;
      player.hand.splice(idx, 1);
      s.discard.push(card);
      s.currentColor = isWild ? action.chosenColor! : card.color;
      effects.push({ type: 'played', seat: action.seat, card });

      if (player.hand.length === 0) {
        s.winner = action.seat;
        effects.push({ type: 'win', seat: action.seat });
        return { ok: true, state: s, effects };
      }
      if (player.hand.length === 1 && !player.calledLastCard) {
        s.catchWindow = { seat: action.seat };
      }

      const active = s.players.filter((p) => !p.removed).length;
      switch (card.value) {
        case 'skip':
          s.turn = nextSeat(s, action.seat, 2);
          break;
        case 'reverse':
          if (active === 2) {
            s.turn = action.seat; // acts as skip: same player again
          } else {
            s.direction = s.direction === 1 ? -1 : 1;
            s.turn = nextSeat(s, action.seat);
          }
          break;
        case 'draw2': {
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 2);
          effects.push({ type: 'drew', seat: victim, count: n });
          s.turn = nextSeat(s, action.seat, 2);
          break;
        }
        case 'wild4': {
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 4);
          effects.push({ type: 'drew', seat: victim, count: n });
          s.turn = nextSeat(s, action.seat, 2);
          break;
        }
        default:
          s.turn = nextSeat(s, action.seat);
      }
      return { ok: true, state: s, effects };
    }

    case 'draw':
    case 'pass':
    case 'callLastCard':
    case 'catchLastCard':
      return err('not implemented yet'); // Tasks 5 and 6 replace this arm
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS (setup tests from Task 3 must still pass too).

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/game.ts server/test/game-play.test.ts server/test/game-wild.test.ts
git commit -m "feat: play reducer with card effects, wilds, and winner detection"
```

---

### Task 5: Reducer — drawing, play-or-pass, reshuffle

**Files:**
- Modify: `server/src/engine/game.ts` (replace the `draw` and `pass` arms of `applyAction`)
- Test: `server/test/game-draw.test.ts`

**Interfaces:**
- Consumes: everything from Task 4 (`applyAction`, `drawFromPile`, `fixedState`/`card` test helpers).
- Produces: working `{ type: 'draw' }` and `{ type: 'pass' }` actions; `pendingDrawn` semantics that Task 7's view projection and Task 12's Table screen rely on: after drawing a playable card, `pendingDrawn = { seat, cardId }` and the turn does not advance until the player plays that card or passes.

- [ ] **Step 1: Write the failing tests**

`server/test/game-draw.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('draw', () => {
  test('unplayable drawn card: hand grows by one, turn advances', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [card('blue', '3')]; // blue 3 does not match red 7 / color red
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
    expect(r.effects).toContainEqual({ type: 'drew', seat: 0, count: 1 });
  });

  test('playable drawn card: pendingDrawn set, turn stays', () => {
    const drawnCard = card('red', '9');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [drawnCard];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.pendingDrawn).toEqual({ seat: 0, cardId: drawnCard.id });
    expect(r.state.turn).toBe(0);
  });

  test('with pendingDrawn: playing another card is rejected, playing the drawn card works', () => {
    const drawnCard = card('red', '9');
    const other = card('red', '1');
    const s = fixedState([[other], [card('green', '2')]], card('red', '7'));
    s.drawPile = [drawnCard];
    const afterDraw = applyAction(s, { type: 'draw', seat: 0 });
    if (!afterDraw.ok) throw new Error(afterDraw.error);
    expect(applyAction(afterDraw.state, { type: 'play', seat: 0, cardId: other.id }).ok).toBe(false);
    const played = applyAction(afterDraw.state, { type: 'play', seat: 0, cardId: drawnCard.id });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.discard.at(-1)!.id).toBe(drawnCard.id);
  });

  test('pass: keeps the drawn card and advances the turn', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [card('red', '9')];
    const afterDraw = applyAction(s, { type: 'draw', seat: 0 });
    if (!afterDraw.ok) throw new Error(afterDraw.error);
    const r = applyAction(afterDraw.state, { type: 'pass', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
  });

  test('pass without a pending drawn card is rejected', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'pass', seat: 0 }).ok).toBe(false);
  });

  test('empty draw pile: discard minus top is reshuffled into it', () => {
    const buried = [card('yellow', '4'), card('yellow', '6')];
    const top = card('red', '7');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], top);
    s.drawPile = [];
    s.discard = [...buried, top];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.discard).toEqual([top]);
    expect(r.state.drawPile.length).toBe(1); // 2 buried − 1 drawn
  });

  test('both piles dry: draw becomes a pass', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [];
    s.discard = [card('red', '7')];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.turn).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — draw/pass return "not implemented yet".

- [ ] **Step 3: Implement the draw and pass arms**

Replace the `case 'draw': case 'pass': case 'callLastCard': case 'catchLastCard':` fall-through in `applyAction` with:

```ts
    case 'draw': {
      if (s.turn !== action.seat) return err('not your turn');
      if (s.mustChooseColor) return err('choose a color first');
      if (s.pendingDrawn?.seat === action.seat) return err('play the drawn card or pass');
      s.catchWindow = null;
      const n = drawFromPile(s, action.seat, 1);
      effects.push({ type: 'drew', seat: action.seat, count: n });
      if (n === 0) {
        s.turn = nextSeat(s, action.seat);
        return { ok: true, state: s, effects };
      }
      const drawnCard = player.hand.at(-1)!;
      const top = s.discard.at(-1)!;
      if (isPlayable(drawnCard, top, s.currentColor)) {
        s.pendingDrawn = { seat: action.seat, cardId: drawnCard.id };
      } else {
        s.turn = nextSeat(s, action.seat);
      }
      return { ok: true, state: s, effects };
    }

    case 'pass': {
      if (s.pendingDrawn?.seat !== action.seat) return err('nothing to pass');
      s.pendingDrawn = null;
      s.turn = nextSeat(s, action.seat);
      return { ok: true, state: s, effects };
    }

    case 'callLastCard':
    case 'catchLastCard':
      return err('not implemented yet'); // Task 6 replaces this arm
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/game.ts server/test/game-draw.test.ts
git commit -m "feat: draw-one with play-or-pass and discard reshuffle"
```

---

### Task 6: Reducer — “last card” call and catch

**Files:**
- Modify: `server/src/engine/game.ts` (replace the `callLastCard` / `catchLastCard` arms)
- Test: `server/test/game-lastcard.test.ts`

**Interfaces:**
- Consumes: Task 4–5 reducer; `catchWindow` semantics from Task 4 (window arms when a player drops to one card without having called; any other action closes it).
- Produces: working `{ type: 'callLastCard' }` and `{ type: 'catchLastCard' }`; `calledLastCard` flag on `SeatView` (projected in Task 7) that the Table screen shows as “· called it”.

- [ ] **Step 1: Write the failing tests**

`server/test/game-lastcard.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('calling before playing', () => {
  test('call with two cards on your turn, then play: no catch window', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0, card('blue', '9')], [card('green', '2')]], card('red', '7'));
    const called = applyAction(s, { type: 'callLastCard', seat: 0 });
    if (!called.ok) throw new Error(called.error);
    expect(called.state.players[0]!.calledLastCard).toBe(true);
    const played = applyAction(called.state, { type: 'play', seat: 0, cardId: c0.id });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.catchWindow).toBeNull();
  });
  test('call is rejected with a full hand out of turn', () => {
    const s = fixedState([[card('red', '3'), card('blue', '9'), card('green', '1')], [card('green', '2')]], card('red', '7'), { turn: 1 });
    expect(applyAction(s, { type: 'callLastCard', seat: 0 }).ok).toBe(false);
  });
});

describe('forgetting to call', () => {
  function windowOpen() {
    const c0 = card('red', '3');
    const s = fixedState([[c0, card('blue', '9')], [card('green', '2')], [card('yellow', '1')]], card('red', '7'));
    const played = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.catchWindow).toEqual({ seat: 0 });
    return played.state;
  }

  test('opponent catches: offender draws two, window closes', () => {
    const r = applyAction(windowOpen(), { type: 'catchLastCard', seat: 2 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(3);
    expect(r.state.players[0]!.calledLastCard).toBe(false);
    expect(r.state.catchWindow).toBeNull();
    expect(r.effects).toContainEqual({ type: 'caught', seat: 0 });
  });

  test('late call inside the window saves the player', () => {
    const st = windowOpen();
    const called = applyAction(st, { type: 'callLastCard', seat: 0 });
    if (!called.ok) throw new Error(called.error);
    expect(called.state.catchWindow).toBeNull();
    expect(applyAction(called.state, { type: 'catchLastCard', seat: 2 }).ok).toBe(false);
  });

  test('window closes when the next player acts', () => {
    const st = windowOpen(); // turn is now seat 1
    const next = applyAction(st, { type: 'draw', seat: 1 });
    if (!next.ok) throw new Error(next.error);
    expect(next.state.catchWindow).toBeNull();
    expect(applyAction(next.state, { type: 'catchLastCard', seat: 2 }).ok).toBe(false);
  });

  test('you cannot catch yourself', () => {
    expect(applyAction(windowOpen(), { type: 'catchLastCard', seat: 0 }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — call/catch return "not implemented yet".

- [ ] **Step 3: Implement the call and catch arms**

Replace the remaining fall-through in `applyAction` with:

```ts
    case 'callLastCard': {
      const ownWindow = s.catchWindow?.seat === action.seat;
      const arming = s.turn === action.seat && player.hand.length <= 2 && player.hand.length > 0;
      if (!ownWindow && !arming) return err('cannot call now');
      player.calledLastCard = true;
      if (ownWindow) s.catchWindow = null;
      effects.push({ type: 'called', seat: action.seat });
      return { ok: true, state: s, effects };
    }

    case 'catchLastCard': {
      if (!s.catchWindow) return err('nothing to catch');
      const target = s.catchWindow.seat;
      if (target === action.seat) return err('cannot catch yourself');
      s.catchWindow = null;
      const n = drawFromPile(s, target, 2);
      effects.push({ type: 'caught', seat: target });
      effects.push({ type: 'drew', seat: target, count: n });
      return { ok: true, state: s, effects };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS — the engine is now rules-complete.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/game.ts server/test/game-lastcard.test.ts
git commit -m "feat: last-card call and catch with penalty"
```

---

### Task 7: Personalized view projection

**Files:**
- Create: `server/src/engine/views.ts`
- Test: `server/test/views.test.ts`

**Interfaces:**
- Consumes: `GameState` (Tasks 3–6); `RoomStateView`, `Phase` from `@uno/shared`.
- Produces:

```ts
export interface ViewContext {
  roomCode: string;
  phase: Phase;
  names: string[];              // by seat
  hostSeat: number;
  connected: boolean[];         // by seat
  winTally: number[];
  pausedForSeat: number | null;
  pausedSinceMs: number | null;
  game: GameState | null;       // null in lobby
}
export function projectView(ctx: ViewContext, seat: number): RoomStateView;
```

Task 8's `RoomStore.viewFor()` builds a `ViewContext` from a room; Task 9 emits the result as `roomState`.

- [ ] **Step 1: Write the failing tests**

`server/test/views.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { projectView, type ViewContext } from '../src/engine/views.js';
import { card, fixedState } from './game-play.test.js';

function ctx(overrides: Partial<ViewContext> = {}): ViewContext {
  const game = fixedState(
    [[card('red', '1'), card('blue', '2')], [card('green', '3')]],
    card('red', '7'),
  );
  return {
    roomCode: '4K2P-9XVB', phase: 'playing',
    names: ['Mira', 'Jonas'], hostSeat: 0,
    connected: [true, true], winTally: [0, 0],
    pausedForSeat: null, pausedSinceMs: null,
    game, ...overrides,
  };
}

describe('projectView', () => {
  test('you see your own hand; opponents appear as counts only', () => {
    const v0 = projectView(ctx(), 0);
    expect(v0.hand).toHaveLength(2);
    expect(v0.seats[1]).toMatchObject({ name: 'Jonas', cardCount: 1 });
    expect(JSON.stringify(v0.seats)).not.toContain('"value"'); // no card objects in seats
    const v1 = projectView(ctx(), 1);
    expect(v1.hand).toHaveLength(1);
    expect(v1.hand[0]!.value).toBe('3');
  });

  test('pendingDrawn and mustChooseColor are personalized', () => {
    const c = ctx();
    c.game!.pendingDrawn = { seat: 0, cardId: c.game!.players[0]!.hand[0]!.id };
    expect(projectView(c, 0).pendingDrawnCardId).not.toBeNull();
    expect(projectView(c, 1).pendingDrawnCardId).toBeNull();
    const c2 = ctx();
    c2.game!.mustChooseColor = true;
    c2.game!.turn = 0;
    expect(projectView(c2, 0).mustChooseColor).toBe(true);
    expect(projectView(c2, 1).mustChooseColor).toBe(false);
  });

  test('removed seats are filtered out of the seat list', () => {
    const c = ctx();
    c.game!.players[1]!.removed = true;
    expect(projectView(c, 0).seats.map((s) => s.seat)).toEqual([0]);
  });

  test('lobby view has empty hand and no top card', () => {
    const v = projectView(ctx({ game: null, phase: 'lobby' }), 0);
    expect(v.hand).toEqual([]);
    expect(v.topCard).toBeNull();
    expect(v.turnSeat).toBeNull();
  });

  test('pause fields carry the disconnected player name', () => {
    const v = projectView(ctx({ pausedForSeat: 1, pausedSinceMs: 12345 }), 0);
    expect(v.paused).toBe(true);
    expect(v.pausedForName).toBe('Jonas');
    expect(v.pausedSinceMs).toBe(12345);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `views.js` not found.

- [ ] **Step 3: Implement projectView**

`server/src/engine/views.ts`:

```ts
import type { Phase, RoomStateView } from '@uno/shared';
import type { GameState } from './game.js';

export interface ViewContext {
  roomCode: string;
  phase: Phase;
  names: string[];
  hostSeat: number;
  connected: boolean[];
  winTally: number[];
  pausedForSeat: number | null;
  pausedSinceMs: number | null;
  game: GameState | null;
}

export function projectView(ctx: ViewContext, seat: number): RoomStateView {
  const g = ctx.game;
  return {
    roomCode: ctx.roomCode,
    phase: ctx.phase,
    yourSeat: seat,
    hand: g ? g.players[seat]!.hand : [],
    seats: ctx.names
      .map((name, i) => ({
        seat: i,
        name,
        cardCount: g ? g.players[i]!.hand.length : 0,
        connected: ctx.connected[i] ?? false,
        calledLastCard: g ? g.players[i]!.calledLastCard : false,
        isHost: i === ctx.hostSeat,
      }))
      .filter((sv) => !g?.players[sv.seat]?.removed),
    turnSeat: g && g.winner === null ? g.turn : null,
    direction: g ? g.direction : 1,
    topCard: g ? g.discard.at(-1)! : null,
    currentColor: g ? g.currentColor : null,
    mustChooseColor: g ? g.mustChooseColor && g.turn === seat : false,
    pendingDrawnCardId: g?.pendingDrawn?.seat === seat ? g.pendingDrawn.cardId : null,
    catchableSeat: g?.catchWindow?.seat ?? null,
    drawPileCount: g ? g.drawPile.length : 0,
    winnerSeat: g ? g.winner : null,
    winTally: ctx.winTally,
    paused: ctx.pausedForSeat !== null,
    pausedForName: ctx.pausedForSeat !== null ? ctx.names[ctx.pausedForSeat]! : null,
    pausedSinceMs: ctx.pausedSinceMs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/views.ts server/test/views.test.ts
git commit -m "feat: personalized room view projection"
```

---

### Task 8: RoomStore — rooms, seats, tokens, lifecycle, GC

**Files:**
- Modify: `server/src/engine/game.ts` (add `removeFromRound`)
- Create: `server/src/rooms.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `createGame`, `applyAction`, `removeFromRound`, `Action` (engine); `projectView`, `ViewContext` (Task 7); `rng` (Task 2).
- Produces (used verbatim by Task 9's socket layer):

```ts
export interface RoomPlayer {
  name: string; token: string;
  socketId: string | null; connected: boolean;
  disconnectedAtMs: number | null; left: boolean;
}
export interface Room {
  code: string;                  // '4K2P-9XVB'
  createdAtMs: number; emptySinceMs: number | null;
  phase: Phase; players: RoomPlayer[]; hostSeat: number;
  game: GameState | null; winTally: number[]; seed: number;
}
export class RoomStore {
  constructor(now?: () => number);
  createRoom(opts?: { seed?: number }): Room;
  getRoom(code: string): Room | undefined;         // case/hyphen-insensitive
  join(code: string, name: string): { ok: true; seat: number; token: string } | { ok: false; error: string };
  resume(code: string, token: string): { ok: true; seat: number } | { ok: false; error: string };
  setConnection(code: string, seat: number, socketId: string | null): void;
  startGame(code: string, token: string): { ok: true } | { ok: false; error: string };
  act(code: string, token: string, action: Omit<Action, 'seat'>): { ok: true; effects: Effect[] } | { ok: false; error: string };
  rematch(code: string, token: string): { ok: true } | { ok: false; error: string };
  continueWithout(code: string, token: string, targetSeat: number): { ok: true } | { ok: false; error: string };
  viewFor(code: string, seat: number): RoomStateView;
  sweep(): void;                                   // GC: empty >10 min or age >24 h
}
export const CONTINUE_GRACE_MS = 120_000;
```

- [ ] **Step 1: Write the failing tests**

`server/test/rooms.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { CONTINUE_GRACE_MS, RoomStore } from '../src/rooms.js';

function makeStartedRoom(store: RoomStore) {
  const room = store.createRoom({ seed: 42 });
  const a = store.join(room.code, 'Mira');
  const b = store.join(room.code, 'Jonas');
  if (!a.ok || !b.ok) throw new Error('join failed');
  const started = store.startGame(room.code, a.token);
  if (!started.ok) throw new Error(started.error);
  return { room, a, b };
}

describe('rooms and joining', () => {
  test('room code format XXXX-XXXX from the Crockford alphabet', () => {
    const store = new RoomStore();
    const { code } = store.createRoom();
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
  });
  test('getRoom ignores case and hyphens', () => {
    const store = new RoomStore();
    const { code } = store.createRoom();
    expect(store.getRoom(code.toLowerCase().replace('-', ''))).toBeDefined();
  });
  test('first joiner is host; fifth join is rejected; join after start is rejected', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const first = store.join(room.code, 'Mira');
    if (!first.ok) throw new Error(first.error);
    expect(first.seat).toBe(0);
    for (const n of ['B', 'C', 'D']) expect(store.join(room.code, n).ok).toBe(true);
    expect(store.join(room.code, 'E').ok).toBe(false);
  });
  test('resume with token returns the same seat', () => {
    const store = new RoomStore();
    const { room, b } = makeStartedRoom(store);
    if (!b.ok) return;
    const r = store.resume(room.code, b.token);
    expect(r).toEqual({ ok: true, seat: 1 });
    expect(store.resume(room.code, 'bogus').ok).toBe(false);
  });
});

describe('starting and playing', () => {
  test('start requires the host token and 2+ players', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const a = store.join(room.code, 'Mira');
    if (!a.ok) return;
    expect(store.startGame(room.code, a.token).ok).toBe(false); // alone
    const b = store.join(room.code, 'Jonas');
    if (!b.ok) return;
    expect(store.startGame(room.code, b.token).ok).toBe(false); // not host
    expect(store.startGame(room.code, a.token).ok).toBe(true);
    expect(store.getRoom(room.code)!.phase).toBe('playing');
  });
  test('act routes by token; win flips phase and bumps the tally', () => {
    const store = new RoomStore();
    const { room, a } = makeStartedRoom(store);
    if (!a.ok) return;
    const g = store.getRoom(room.code)!.game!;
    // hand the winner a single matching card to finish immediately
    const top = g.discard.at(-1)!;
    g.players[g.turn]!.hand = [{ id: 9999, color: top.color ?? 'red', value: top.value }];
    if (g.mustChooseColor) { g.mustChooseColor = false; g.currentColor = 'red'; g.players[g.turn]!.hand = [{ id: 9999, color: 'red', value: '5' }]; }
    const turnSeat = g.turn;
    const token = turnSeat === 0 ? a.token : (store.getRoom(room.code)!.players[turnSeat]!.token);
    const r = store.act(room.code, token, { type: 'play', cardId: 9999 } as never);
    expect(r.ok).toBe(true);
    const after = store.getRoom(room.code)!;
    expect(after.phase).toBe('roundEnd');
    expect(after.winTally[turnSeat]).toBe(1);
  });
  test('rematch reshuffles and returns to playing with kept seats', () => {
    const store = new RoomStore();
    const { room, a } = makeStartedRoom(store);
    if (!a.ok) return;
    store.getRoom(room.code)!.phase = 'roundEnd';
    expect(store.rematch(room.code, a.token).ok).toBe(true);
    const after = store.getRoom(room.code)!;
    expect(after.phase).toBe('playing');
    expect(after.game!.players.every((p) => p.hand.length >= 7)).toBe(true);
  });
});

describe('disconnects and continue-without', () => {
  test('rejected before the 2-minute grace, allowed after; cards are buried', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, a } = makeStartedRoom(store);
    if (!a.ok) return;
    store.setConnection(room.code, 1, null); // Jonas drops
    expect(store.continueWithout(room.code, a.token, 1).ok).toBe(false);
    clock += CONTINUE_GRACE_MS + 1;
    const pileBefore = store.getRoom(room.code)!.game!.drawPile.length;
    const handSize = store.getRoom(room.code)!.game!.players[1]!.hand.length;
    expect(store.continueWithout(room.code, a.token, 1).ok).toBe(true);
    const g = store.getRoom(room.code)!.game!;
    expect(g.players[1]!.removed).toBe(true);
    expect(g.drawPile.length).toBe(pileBefore + handSize);
    // 2-player room: removing one ends the round in the survivor's favor
    expect(g.winner).toBe(0);
    expect(store.getRoom(room.code)!.phase).toBe('roundEnd');
  });
});

describe('garbage collection', () => {
  test('empty rooms die after 10 minutes; any room dies after 24 hours', () => {
    let clock = 0;
    const store = new RoomStore(() => clock);
    const emptyRoom = store.createRoom();
    const oldRoom = store.createRoom();
    const keep = store.createRoom();
    store.join(oldRoom.code, 'A');
    store.join(keep.code, 'B');
    store.setConnection(keep.code, 0, 'sock-1'); // connected → survives
    clock = 11 * 60_000;
    store.sweep();
    expect(store.getRoom(emptyRoom.code)).toBeUndefined();
    expect(store.getRoom(oldRoom.code)).toBeUndefined(); // joined but no live socket → empty since creation
    expect(store.getRoom(keep.code)).toBeDefined();      // has a connected player
    clock = 25 * 60 * 60_000;
    store.sweep();
    expect(store.getRoom(keep.code)).toBeUndefined();    // 24 h cap
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `rooms.js` not found.

- [ ] **Step 3: Implement removeFromRound in the engine**

Append to `server/src/engine/game.ts`:

```ts
/** Remove a seat from the current round: bury their cards at the bottom of the
 *  draw pile, fix the turn, and end the round if only one player remains. */
export function removeFromRound(state: GameState, seat: number): GameState {
  const s = structuredClone(state);
  const p = s.players[seat]!;
  p.removed = true;
  s.drawPile.unshift(...p.hand);
  p.hand = [];
  if (s.pendingDrawn?.seat === seat) s.pendingDrawn = null;
  if (s.catchWindow?.seat === seat) s.catchWindow = null;
  const active = s.players.flatMap((pl, i) => (pl.removed ? [] : [i]));
  if (active.length === 1) {
    s.winner = active[0]!;
    return s;
  }
  if (s.turn === seat) {
    if (s.mustChooseColor) {
      s.mustChooseColor = false;
      s.currentColor = s.discard.at(-1)!.color ?? 'red';
    }
    s.turn = nextSeat(s, seat);
  }
  return s;
}
```

- [ ] **Step 4: Implement RoomStore**

`server/src/rooms.ts`:

```ts
import { randomBytes, randomInt } from 'node:crypto';
import type { Effect, Phase, RoomStateView } from '@uno/shared';
import {
  applyAction, createGame, removeFromRound, type Action, type GameState,
} from './engine/game.js';
import { rng } from './engine/deck.js';
import { projectView } from './engine/views.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CONTINUE_GRACE_MS = 120_000;
const EMPTY_TTL_MS = 10 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_SEATS = 4;

export interface RoomPlayer {
  name: string; token: string;
  socketId: string | null; connected: boolean;
  disconnectedAtMs: number | null; left: boolean;
}

export interface Room {
  code: string;
  createdAtMs: number; emptySinceMs: number | null;
  phase: Phase; players: RoomPlayer[]; hostSeat: number;
  game: GameState | null; winTally: number[]; seed: number;
}

const norm = (code: string) => code.toUpperCase().replaceAll('-', '');

export class RoomStore {
  private rooms = new Map<string, Room>();
  constructor(private now: () => number = Date.now) {}

  createRoom(opts: { seed?: number } = {}): Room {
    let key: string;
    do {
      key = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(key));
    const room: Room = {
      code: `${key.slice(0, 4)}-${key.slice(4)}`,
      createdAtMs: this.now(), emptySinceMs: this.now(),
      phase: 'lobby', players: [], hostSeat: 0,
      game: null, winTally: [],
      seed: opts.seed ?? randomInt(2 ** 31),
    };
    this.rooms.set(key, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(norm(code));
  }

  join(code: string, name: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'game already started' };
    if (room.players.length >= MAX_SEATS) return { ok: false as const, error: 'table is full' };
    const token = randomBytes(16).toString('hex');
    room.players.push({
      name: name.trim().slice(0, 24) || 'Player',
      token, socketId: null, connected: false, disconnectedAtMs: null, left: false,
    });
    room.winTally.push(0);
    return { ok: true as const, seat: room.players.length - 1, token };
  }

  resume(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    const seat = room.players.findIndex((p) => p.token === token && !p.left);
    if (seat === -1) return { ok: false as const, error: 'seat not found' };
    return { ok: true as const, seat };
  }

  setConnection(code: string, seat: number, socketId: string | null): void {
    const room = this.getRoom(code);
    const player = room?.players[seat];
    if (!room || !player) return;
    player.socketId = socketId;
    player.connected = socketId !== null;
    player.disconnectedAtMs = socketId === null ? this.now() : null;
    room.emptySinceMs = room.players.some((p) => p.connected && !p.left) ? null : this.now();
  }

  private seatFor(room: Room, token: string): number {
    return room.players.findIndex((p) => p.token === token && !p.left);
  }

  startGame(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    const seat = this.seatFor(room, token);
    if (seat !== room.hostSeat) return { ok: false as const, error: 'only the host can deal' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'already dealt' };
    if (room.players.length < 2) return { ok: false as const, error: 'need at least two players' };
    room.game = createGame(room.players.length, rng(room.seed));
    room.phase = 'playing';
    return { ok: true as const };
  }

  act(code: string, token: string, action: Omit<Action, 'seat'>) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'playing' || !room.game) return { ok: false as const, error: 'no round in progress' };
    const seat = this.seatFor(room, token);
    if (seat === -1) return { ok: false as const, error: 'seat not found' };
    const result = applyAction(room.game, { ...action, seat } as Action);
    if (!result.ok) return result;
    room.game = result.state;
    if (result.state.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[result.state.winner] = (room.winTally[result.state.winner] ?? 0) + 1;
    }
    return { ok: true as const, effects: result.effects };
  }

  rematch(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'roundEnd') return { ok: false as const, error: 'round still running' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat not found' };
    // Compact away players who left; keep everyone else's seat order and tally.
    const stayingIdx = room.players.flatMap((p, i) => (p.left ? [] : [i]));
    room.players = stayingIdx.map((i) => room.players[i]!);
    room.winTally = stayingIdx.map((i) => room.winTally[i]!);
    room.hostSeat = 0;
    if (room.players.length < 2) return { ok: false as const, error: 'not enough players' };
    room.seed = randomInt(2 ** 31);
    room.game = createGame(room.players.length, rng(room.seed));
    room.phase = 'playing';
    return { ok: true as const };
  }

  continueWithout(code: string, token: string, targetSeat: number) {
    const room = this.getRoom(code);
    if (!room || !room.game) return { ok: false as const, error: 'table not found' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat not found' };
    const target = room.players[targetSeat];
    if (!target || target.left) return { ok: false as const, error: 'no such seat' };
    if (target.connected) return { ok: false as const, error: 'player is connected' };
    if (target.disconnectedAtMs === null || this.now() - target.disconnectedAtMs < CONTINUE_GRACE_MS) {
      return { ok: false as const, error: 'grace period still running' };
    }
    target.left = true;
    room.game = removeFromRound(room.game, targetSeat);
    if (room.game.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[room.game.winner] = (room.winTally[room.game.winner] ?? 0) + 1;
    }
    return { ok: true as const };
  }

  pausedForSeat(room: Room): number | null {
    if (room.phase !== 'playing') return null;
    const seat = room.players.findIndex((p) => !p.left && !p.connected);
    return seat === -1 ? null : seat;
  }

  viewFor(code: string, seat: number): RoomStateView {
    const room = this.getRoom(code)!;
    const pausedSeat = this.pausedForSeat(room);
    return projectView({
      roomCode: room.code, phase: room.phase,
      names: room.players.map((p) => p.name),
      hostSeat: room.hostSeat,
      connected: room.players.map((p) => p.connected),
      winTally: room.winTally,
      pausedForSeat: pausedSeat,
      pausedSinceMs: pausedSeat !== null ? room.players[pausedSeat]!.disconnectedAtMs : null,
      game: room.game,
    }, seat);
  }

  sweep(): void {
    for (const [key, room] of this.rooms) {
      const age = this.now() - room.createdAtMs;
      const emptyFor = room.emptySinceMs === null ? 0 : this.now() - room.emptySinceMs;
      if (age > MAX_AGE_MS || emptyFor > EMPTY_TTL_MS) this.rooms.delete(key);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms.ts server/src/engine/game.ts server/test/rooms.test.ts
git commit -m "feat: room store with seats, tokens, continue-without, and GC"
```

---

### Task 9: Socket layer, HTTP server, and the round-trip integration test

**Files:**
- Create: `server/src/sockets.ts`, `server/src/server.ts`
- Test: `server/test/integration.test.ts`

**Interfaces:**
- Consumes: `RoomStore` (Task 8); `ClientToServerEvents`, `ServerToClientEvents`, `isPlayable` from `@uno/shared`.
- Produces: `attachSockets(io, store)`; `buildServer(store?): Promise<{ app: FastifyInstance; io: Server; store: RoomStore }>`; running entrypoint (`node dist/server.js`) that listens on `process.env.PORT ?? 3000`, sweeps the store every 60 s, and serves `server/public/` with an SPA fallback so `/r/XXXX-XXXX` loads the client.

- [ ] **Step 1: Implement the socket layer (wiring, no game logic)**

`server/src/sockets.ts`:

```ts
import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import type { RoomStore } from './rooms.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

export function attachSockets(io: IO, store: RoomStore): void {
  const broadcast = (code: string) => {
    const room = store.getRoom(code);
    if (!room) return;
    for (const [seat, player] of room.players.entries()) {
      if (player.left || player.socketId === null) continue;
      io.to(player.socketId).emit('roomState', store.viewFor(code, seat));
    }
  };
  const emitEffects = (code: string, effects: { type: string }[] | undefined) => {
    const room = store.getRoom(code);
    if (!room || !effects) return;
    for (const player of room.players) {
      if (player.left || player.socketId === null) continue;
      for (const e of effects) io.to(player.socketId).emit('effect', e as never);
    }
  };

  io.on('connection', (socket: Sock) => {
    const seatOf = () => socket.data as { code: string; seat: number; token: string };

    socket.on('joinRoom', (p, ack) => {
      const existing = p.token ? store.resume(p.code, p.token) : { ok: false as const, error: '' };
      const joined = existing.ok
        ? { ok: true as const, seat: existing.seat, token: p.token! }
        : store.join(p.code, p.name ?? 'Player');
      if (!joined.ok) return ack({ ok: false, error: joined.error });
      socket.data = { code: p.code, seat: joined.seat, token: joined.token };
      store.setConnection(p.code, joined.seat, socket.id);
      const room = store.getRoom(p.code)!;
      ack({ ok: true, seat: joined.seat, token: joined.token, roomName: `${room.players[room.hostSeat]!.name}’s table` });
      broadcast(p.code);
    });

    const handle = (fn: () => { ok: boolean; error?: string; effects?: never[] } | { ok: boolean; error?: string }) => {
      const { code } = seatOf();
      if (!code) return;
      const result = fn() as { ok: boolean; error?: string; effects?: never[] };
      if (!result.ok) {
        socket.emit('moveRejected', { reason: result.error ?? 'rejected' });
        return;
      }
      emitEffects(code, result.effects);
      broadcast(code);
    };

    socket.on('startGame', () => handle(() => store.startGame(seatOf().code, seatOf().token)));
    socket.on('playCard', (p) => handle(() => store.act(seatOf().code, seatOf().token, { type: 'play', cardId: p.cardId, chosenColor: p.chosenColor })));
    socket.on('drawCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'draw' })));
    socket.on('passTurn', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'pass' })));
    socket.on('chooseColor', (p) => handle(() => store.act(seatOf().code, seatOf().token, { type: 'chooseColor', color: p.color })));
    socket.on('callLastCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'callLastCard' })));
    socket.on('catchLastCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'catchLastCard' })));
    socket.on('rematch', () => handle(() => store.rematch(seatOf().code, seatOf().token)));
    socket.on('continueWithout', (p) => handle(() => store.continueWithout(seatOf().code, seatOf().token, p.seat)));

    socket.on('disconnect', () => {
      const { code, seat } = seatOf();
      if (!code) return;
      store.setConnection(code, seat, null);
      broadcast(code);
    });
  });
}
```

- [ ] **Step 2: Implement the HTTP server**

`server/src/server.ts`:

```ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import { RoomStore } from './rooms.js';
import { attachSockets } from './sockets.js';

export async function buildServer(store = new RoomStore()) {
  const app = Fastify();

  app.post('/api/rooms', async () => {
    const room = store.createRoom();
    return { code: room.code };
  });

  const publicDir = path.resolve(import.meta.dirname, '../public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html')); // SPA: /r/CODE
  }

  await app.ready();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  attachSockets(io, store);
  return { app, io, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, store } = await buildServer();
  setInterval(() => store.sweep(), 60_000).unref();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Ochre Eights listening on :${port}`);
}
```

- [ ] **Step 3: Write the integration test (two clients play a full round)**

`server/test/integration.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { isPlayable, type RoomStateView } from '@uno/shared';
import { buildServer } from '../src/server.js';
import { RoomStore } from '../src/rooms.js';

let ctx: Awaited<ReturnType<typeof buildServer>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await buildServer(new RoomStore());
  await ctx.app.listen({ port: 0 });
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.app.close();
});

function client(): Socket {
  const s = connect(url, { transports: ['websocket'] });
  sockets.push(s);
  return s;
}

function joinAck(s: Socket, code: string, name: string) {
  return new Promise<{ ok: boolean; seat?: number; token?: string }>((resolve) =>
    s.emit('joinRoom', { code, name }, resolve),
  );
}

test('two clients join, deal, and play to a winner with hidden hands', { timeout: 30_000 }, async () => {
  const room = ctx.store.createRoom({ seed: 7 });

  const views = new Map<number, RoomStateView>();
  let winner: number | null = null;
  const a = client();
  const b = client();

  const drive = (view: RoomStateView) => {
    views.set(view.yourSeat, view);
    // Hidden-hand invariant: seats never carry card objects.
    expect(JSON.stringify(view.seats)).not.toContain('"value"');
    if (view.winnerSeat !== null) { winner = view.winnerSeat; return; }
    if (view.turnSeat !== view.yourSeat || view.paused) return;
    const sock = view.yourSeat === 0 ? a : b;
    if (view.mustChooseColor) return void sock.emit('chooseColor', { color: 'red' });
    if (view.pendingDrawnCardId !== null) {
      return void sock.emit('playCard', { cardId: view.pendingDrawnCardId, chosenColor: 'red' });
    }
    const playable = view.hand.find((c) => isPlayable(c, view.topCard!, view.currentColor));
    if (playable) {
      const needsColor = playable.value === 'wild' || playable.value === 'wild4';
      sock.emit('playCard', { cardId: playable.id, chosenColor: needsColor ? 'red' : undefined });
    } else {
      sock.emit('drawCard');
    }
  };

  a.on('roomState', drive);
  b.on('roomState', drive);
  a.on('moveRejected', (p) => { throw new Error(`A rejected: ${p.reason}`); });

  const ackA = await joinAck(a, room.code, 'Mira');
  const ackB = await joinAck(b, room.code, 'Jonas');
  expect(ackA.ok && ackB.ok).toBe(true);

  a.emit('startGame');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no winner after 25s')), 25_000);
    const check = setInterval(() => {
      if (winner !== null) { clearTimeout(timer); clearInterval(check); resolve(); }
    }, 50);
  });

  expect([0, 1]).toContain(winner);
  expect(ctx.store.getRoom(room.code)!.phase).toBe('roundEnd');
});
```

- [ ] **Step 4: Run the integration test**

Run: `npm test -w server`
Expected: PASS — a scripted round reaches a winner over real sockets.
If it hangs, debug with `DEBUG=socket.io* npm test -w server`.

- [ ] **Step 5: Verify the server boots**

Run: `npm run build -w shared && npm run dev -w server` then `curl -X POST localhost:3000/api/rooms`
Expected: `{"code":"XXXX-XXXX"}`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add server/src/sockets.ts server/src/server.ts server/test/integration.test.ts
git commit -m "feat: socket layer and HTTP server with round-trip integration test"
```

---

### Task 10: Client scaffold, socket store, and the entry screens

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/{main.tsx,App.tsx,socket.ts,store.tsx,game.css}`
- Create: `client/src/ds.css` (vendored copy — see Step 1)
- Create: `client/src/screens/{Landing,HostLink,Join}.tsx`

**Interfaces:**
- Consumes: `@uno/shared` types; server endpoints from Task 9 (`POST /api/rooms`, socket events).
- Produces: `socket` singleton (`client/src/socket.ts`); `StoreProvider` + `useStore()` returning `{ view, error, rejection, effect, join(code, name?), actions }` where `actions = { start, play(cardId, chosenColor?), draw, pass, chooseColor(color), call, catchCall, rematch, continueWithout(seat) }`. Tasks 11–13 build screens on `useStore()` exactly as defined here. Localstorage key for a seat token: `` `ochre:${code.toUpperCase()}` ``.

- [ ] **Step 1: Scaffold the package and vendor the design system**

`client/package.json`:

```json
{
  "name": "@uno/client",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "build": "tsc -b && vite build", "dev": "vite" },
  "dependencies": {
    "@uno/shared": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "socket.io-client": "^4.8.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-tsc", "rootDir": "src", "jsx": "react-jsx",
    "module": "ESNext", "moduleResolution": "bundler", "noEmit": true, "composite": false
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

`client/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
```

`client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ochre Eights</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Vendor the design system (one command, then commit the copy):

```bash
cp "design/_ds/organic-bda5c1fb-32bb-456d-af48-027563f741ed/styles.css" client/src/ds.css
```

`client/src/game.css` (base layer — Table styling grows in Task 12):

```css
/* Ochre Eights game layer on top of the Organic DS tokens (ds.css). */
:root {
  --card-red: #c25f4e;
  --card-blue: #5c86a8;
  --card-yellow: #d9a441;
  --card-green: #7f9a5c;
  --card-back: #b2622d;
  --card-cream: #fdf8ef;
  --felt: #dfe6cd;
}
.screen {
  min-height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: var(--space-4); padding: var(--space-6);
  text-align: center;
}
.brand-mark {
  width: 56px; height: 56px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--card-back); color: var(--card-cream);
  font-family: var(--font-heading); font-size: 26px;
}
.code-chip {
  font-family: ui-monospace, monospace; font-size: 20px; letter-spacing: 0.08em;
  background: var(--color-surface); border-radius: 999px;
  padding: var(--space-2) var(--space-4);
}
```

- [ ] **Step 2: Socket singleton and store**

`client/src/socket.ts`:

```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const socket: GameSocket = io({ autoConnect: false, transports: ['websocket'] });
```

`client/src/store.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Color, Effect, RoomStateView } from '@uno/shared';
import { socket } from './socket';

export interface Store {
  view: RoomStateView | null;
  error: string | null;      // fatal join error → "table not found" screen
  rejection: string | null;  // transient moveRejected, clears itself
  effect: Effect | null;
  join: (code: string, name?: string) => void;
  actions: {
    start: () => void;
    play: (cardId: number, chosenColor?: Color) => void;
    draw: () => void;
    pass: () => void;
    chooseColor: (color: Color) => void;
    call: () => void;
    catchCall: () => void;
    rematch: () => void;
    continueWithout: (seat: number) => void;
  };
}

const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
};

const tokenKey = (code: string) => `ochre:${code.toUpperCase()}`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [effect, setEffect] = useState<Effect | null>(null);

  useEffect(() => {
    const onReject = (p: { reason: string }) => {
      setRejection(p.reason);
      setTimeout(() => setRejection(null), 1500);
    };
    socket.on('roomState', setView);
    socket.on('moveRejected', onReject);
    socket.on('effect', setEffect);
    return () => {
      socket.off('roomState', setView);
      socket.off('moveRejected', onReject);
      socket.off('effect', setEffect);
    };
  }, []);

  // Socket.IO reconnected (phone unlocked, network back): retake the held seat.
  useEffect(() => {
    const code = view?.roomCode;
    if (!code) return;
    const onReconnect = () => {
      const token = localStorage.getItem(tokenKey(code)) ?? undefined;
      socket.emit('joinRoom', { code, token }, () => {});
    };
    socket.io.on('reconnect', onReconnect);
    return () => { socket.io.off('reconnect', onReconnect); };
  }, [view?.roomCode]);

  const join = (code: string, name?: string) => {
    const token = localStorage.getItem(tokenKey(code)) ?? undefined;
    if (!socket.connected) socket.connect();
    socket.emit('joinRoom', { code, name, token }, (ack) => {
      if (!ack.ok || !ack.token) { setError(ack.error ?? 'table not found'); return; }
      localStorage.setItem(tokenKey(code), ack.token);
    });
  };

  const actions = useMemo<Store['actions']>(() => ({
    start: () => socket.emit('startGame'),
    play: (cardId, chosenColor) => socket.emit('playCard', { cardId, chosenColor }),
    draw: () => socket.emit('drawCard'),
    pass: () => socket.emit('passTurn'),
    chooseColor: (color) => socket.emit('chooseColor', { color }),
    call: () => socket.emit('callLastCard'),
    catchCall: () => socket.emit('catchLastCard'),
    rematch: () => socket.emit('rematch'),
    continueWithout: (seat) => socket.emit('continueWithout', { seat }),
  }), []);

  return (
    <Ctx.Provider value={{ view, error, rejection, effect, join, actions }}>
      {children}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 3: App shell and the three entry screens**

`client/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './store';
import './ds.css';
import './game.css';

createRoot(document.getElementById('root')!).render(
  <StoreProvider><App /></StoreProvider>,
);
```

`client/src/App.tsx` — screens for `lobby`/`playing`/`roundEnd` are a raw state dump in this task; Tasks 11–13 swap in the real screens:

```tsx
import Landing from './screens/Landing';
import Join from './screens/Join';
import { useStore } from './store';

export default function App() {
  const { view, error } = useStore();
  const match = /^\/r\/([A-Za-z0-9-]+)/.exec(window.location.pathname);

  if (error) {
    return (
      <main className="screen">
        <div className="brand-mark">8</div>
        <h2>Table not found</h2>
        <p className="text-muted">The link may have expired — tables close after a while.</p>
        <a className="btn btn-primary" href="/">Back to start</a>
      </main>
    );
  }
  if (!match) return <Landing />;
  if (!view) return <Join code={match[1]!} />;
  return <pre style={{ padding: 24 }}>{JSON.stringify(view, null, 2)}</pre>; // Tasks 11-13 replace
}
```

`client/src/screens/Landing.tsx` (also hosts the post-create link screen):

```tsx
import { useState } from 'react';
import HostLink from './HostLink';

export default function Landing() {
  const [code, setCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [token, setToken] = useState('');

  if (code) return <HostLink code={code} />;

  const createRoom = async () => {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const body = (await res.json()) as { code: string };
    setCode(body.code);
  };

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h1>Ochre Eights</h1>
      <p className="text-muted">
        Deal a game in ten seconds. Make a room, send the link —
        up to four at the table. No account needed.
      </p>
      {!joining ? (
        <>
          <button className="btn btn-primary" onClick={createRoom}>Create a room</button>
          <button className="btn btn-ghost" onClick={() => setJoining(true)}>I have an invite</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); window.location.href = `/r/${token.trim()}`; }}>
          <div className="field">
            <label htmlFor="token">Invite token</label>
            <input id="token" className="input" value={token} placeholder="4K2P-9XVB"
              onChange={(e) => setToken(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={!token.trim()}>
            Find the table
          </button>
        </form>
      )}
    </main>
  );
}
```

`client/src/screens/HostLink.tsx`:

```tsx
export default function HostLink({ code }: { code: string }) {
  const link = `${window.location.origin}/r/${code}`;
  return (
    <main className="screen">
      <h2>Your table is ready</h2>
      <p className="text-muted">Send this link — or just the token — to your players.</p>
      <div className="code-chip">{code}</div>
      <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(link)}>
        Copy invite link
      </button>
      <a className="btn btn-primary" href={`/r/${code}`}>Open the room</a>
    </main>
  );
}
```

`client/src/screens/Join.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useStore } from '../store';

export default function Join({ code }: { code: string }) {
  const { join } = useStore();
  const [name, setName] = useState('');

  // A held seat (token in localStorage) rejoins without asking for a name.
  useEffect(() => {
    if (localStorage.getItem(`ochre:${code.toUpperCase()}`)) join(code);
  }, [code]);

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h2>Join the table</h2>
      <form onSubmit={(e) => { e.preventDefault(); join(code, name); }}>
        <div className="field">
          <label htmlFor="name">Your name at the table</label>
          <input id="name" className="input" value={name} maxLength={24}
            onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={!name.trim()}>
          Take a seat
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Verify manually**

Run `npm install`, then in two terminals: `npm run dev -w server` and `npm run dev -w client`.
Open `http://localhost:5173`: create a room, copy the link, open it in a second browser
  (or private window), join with a name.
Expected: both windows show the JSON state dump with two seats; killing one window and
  reopening the link restores the same seat without asking for a name.

- [ ] **Step 5: Commit**

```bash
git add client/
git commit -m "feat: client scaffold with socket store and entry screens"
```

---

### Task 11: Lobby screen

**Files:**
- Create: `client/src/screens/Lobby.tsx`
- Modify: `client/src/App.tsx` (route `phase === 'lobby'`)
- Modify: `client/src/game.css` (append lobby styles)

**Interfaces:**
- Consumes: `useStore()` (`view.seats`, `view.yourSeat`, `actions.start`); DS classes `.btn`, `.tag`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Implement the screen**

`client/src/screens/Lobby.tsx`:

```tsx
import { useStore } from '../store';

export default function Lobby() {
  const { view, actions } = useStore();
  if (!view) return null;
  const you = view.seats.find((s) => s.seat === view.yourSeat);
  const isHost = you?.isHost ?? false;
  const link = `${window.location.origin}/r/${view.roomCode}`;

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h2>{view.seats.find((s) => s.isHost)?.name}’s table</h2>
      <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(link)}>
        Copy invite · {view.roomCode}
      </button>
      <ul className="lobby-seats">
        {view.seats.map((s) => (
          <li key={s.seat} className="lobby-seat">
            <span className="seat-avatar">{s.name[0]?.toUpperCase()}</span>
            <span>{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</span>
            {s.isHost && <span className="tag tag-accent">Host</span>}
            {!s.connected && <span className="tag tag-neutral">away</span>}
          </li>
        ))}
        {Array.from({ length: 4 - view.seats.length }, (_, i) => (
          <li key={`open-${i}`} className="lobby-seat lobby-seat-open">
            <span className="seat-avatar">+</span><span>Seat open</span>
          </li>
        ))}
      </ul>
      {isHost ? (
        <button className="btn btn-primary" disabled={view.seats.length < 2} onClick={actions.start}>
          Deal the first hand
        </button>
      ) : (
        <p className="text-muted">Waiting for the host to deal…</p>
      )}
      <p className="text-muted">{view.seats.length} of 4 seated</p>
    </main>
  );
}
```

Append to `client/src/game.css`:

```css
.lobby-seats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); min-width: 260px; }
.lobby-seat {
  display: flex; align-items: center; gap: var(--space-3);
  background: var(--color-surface); border-radius: 999px;
  padding: var(--space-2) var(--space-4); box-shadow: var(--shadow-sm);
}
.lobby-seat-open { opacity: 0.5; box-shadow: none; border: 1px dashed var(--color-divider); background: transparent; }
.seat-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex: none;
  display: grid; place-items: center;
  background: var(--color-accent-2-400); color: var(--card-cream);
  font-family: var(--font-heading);
}
```

In `client/src/App.tsx`, replace the JSON dump line with:

```tsx
  if (view.phase === 'lobby') return <Lobby />;
  return <pre style={{ padding: 24 }}>{JSON.stringify(view, null, 2)}</pre>; // Tasks 12-13 replace
```

and add `import Lobby from './screens/Lobby';`.

- [ ] **Step 2: Verify manually**

Two browsers: create, join with both.
Expected: both see the seat list update live; only the host has an enabled
  “Deal the first hand” once 2+ are seated; clicking it flips both windows to the JSON dump
  with `"phase": "playing"`.

- [ ] **Step 3: Commit**

```bash
git add client/src/screens/Lobby.tsx client/src/App.tsx client/src/game.css
git commit -m "feat: lobby screen with live seats and host deal"
```

---

### Task 12: Table screen — felt, seats, hand, actions

**Files:**
- Create: `client/src/components/{CardFace,Seat,ColorPicker}.tsx`
- Create: `client/src/screens/Table.tsx`
- Modify: `client/src/App.tsx` (route `phase === 'playing'`)
- Modify: `client/src/game.css` (append table styles)

**Interfaces:**
- Consumes: `useStore()`; `isPlayable` from `@uno/shared`.
- Produces: `CardFace({ card?, back?, size?, playable?, raised?, onClick? })` and `Seat({ seat, active })` reused by Task 13's overlays; CSS classes `.table-felt`, `.hand`, `.stage` extended by Task 14's mobile pass.

- [ ] **Step 1: Card face component**

`client/src/components/CardFace.tsx`:

```tsx
import type { Card } from '@uno/shared';

const GLYPH: Partial<Record<Card['value'], string>> = {
  skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4',
};

export default function CardFace({ card, back = false, size = 'md', playable = false, raised = false, onClick }: {
  card?: Card; back?: boolean; size?: 'sm' | 'md' | 'lg';
  playable?: boolean; raised?: boolean; onClick?: () => void;
}) {
  const suit = back
    ? 'var(--card-back)'
    : card?.color ? `var(--card-${card.color})` : '#3b352d';
  const glyph = back ? '8' : card ? (GLYPH[card.value] ?? card.value) : '';
  return (
    <button
      type="button"
      className={`cardface cardface-${size}${playable ? ' cardface-playable' : ''}${raised ? ' cardface-raised' : ''}`}
      style={{ ['--suit' as never]: suit }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={back ? 'card back' : `${card?.color ?? 'wild'} ${card?.value}`}
    >
      <span className="cardface-frame">
        <span className="cardface-oval"><span className="cardface-glyph">{glyph}</span></span>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Opponent seat and color picker**

`client/src/components/Seat.tsx`:

```tsx
import type { SeatView } from '@uno/shared';
import CardFace from './CardFace';

export default function Seat({ seat, active }: { seat: SeatView; active: boolean }) {
  return (
    <div className={`opp${active ? ' opp-active' : ''}`}>
      <div className="opp-fan">
        {Array.from({ length: Math.min(seat.cardCount, 5) }, (_, i) => (
          <CardFace key={i} back size="sm" />
        ))}
      </div>
      <div className="opp-pill">
        <span className="seat-avatar">{seat.name[0]?.toUpperCase()}</span>
        <span className="opp-name">{seat.name}</span>
        <span className="text-muted">
          {seat.cardCount}{seat.calledLastCard ? ' · called it' : ''}{!seat.connected ? ' · away' : ''}
        </span>
      </div>
    </div>
  );
}
```

`client/src/components/ColorPicker.tsx`:

```tsx
import type { Color } from '@uno/shared';

const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];

export default function ColorPicker({ onPick, title }: { onPick: (c: Color) => void; title: string }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-title">{title}</div>
        <div className="colorpicker-row">
          {COLORS.map((c) => (
            <button key={c} type="button" className="colorpicker-dot"
              style={{ background: `var(--card-${c})` }} aria-label={c}
              onClick={() => onPick(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The table screen**

`client/src/screens/Table.tsx`:

```tsx
import { useState } from 'react';
import { isPlayable, type Card } from '@uno/shared';
import CardFace from '../components/CardFace';
import ColorPicker from '../components/ColorPicker';
import Seat from '../components/Seat';
import { useStore } from '../store';

const COLOR_NAME = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' } as const;

export default function Table() {
  const { view, actions, rejection } = useStore();
  const [wildCardId, setWildCardId] = useState<number | null>(null);
  if (!view || !view.topCard) return null;

  const yourTurn = view.turnSeat === view.yourSeat;
  const opponents = view.seats.filter((s) => s.seat !== view.yourSeat);
  // 1 opponent → top; 2 → left+right; 3 → left+top+right (matches the Sunroom mockup).
  const slots: Record<number, string[]> = { 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'] };
  const slotNames = slots[opponents.length] ?? ['top'];

  const turnName = view.turnSeat === null ? '' :
    view.turnSeat === view.yourSeat ? 'your turn' :
    `${view.seats.find((s) => s.seat === view.turnSeat)?.name}’s turn`;
  const banner = view.currentColor
    ? `${COLOR_NAME[view.currentColor]} is live · ${turnName}`
    : `Pick a color · ${turnName}`;

  const canPlay = (c: Card) =>
    yourTurn && !view.mustChooseColor &&
    (view.pendingDrawnCardId === null || view.pendingDrawnCardId === c.id) &&
    isPlayable(c, view.topCard!, view.currentColor);

  const playCard = (c: Card) => {
    if (c.value === 'wild' || c.value === 'wild4') setWildCardId(c.id);
    else actions.play(c.id);
  };

  const canCall = (yourTurn && view.hand.length <= 2) || view.catchableSeat === view.yourSeat;
  const canCatch = view.catchableSeat !== null && view.catchableSeat !== view.yourSeat;

  return (
    <main className="table-screen">
      <div className="table-felt">
        {opponents.map((s, i) => (
          <div key={s.seat} className={`opp-slot opp-slot-${slotNames[i]}`}>
            <Seat seat={s} active={view.turnSeat === s.seat} />
          </div>
        ))}
        <div className="stage">
          <CardFace back size="lg" onClick={yourTurn && view.pendingDrawnCardId === null ? actions.draw : undefined} />
          <CardFace card={view.topCard} size="lg" />
          <span className="live-dot" style={{ background: view.currentColor ? `var(--card-${view.currentColor})` : '#3b352d' }} />
        </div>
        <div className="banner">{rejection ?? banner}</div>
      </div>

      <div className="hand-dock">
        <div className="hand">
          {view.hand.map((c) => (
            <CardFace key={c.id} card={c}
              playable={canPlay(c)}
              raised={view.pendingDrawnCardId === c.id}
              onClick={canPlay(c) ? () => playCard(c) : undefined} />
          ))}
        </div>
        <div className="hand-actions">
          <span className="opp-pill">
            <span className="seat-avatar">{view.seats.find((s) => s.seat === view.yourSeat)?.name[0]?.toUpperCase()}</span>
            <strong>You</strong>
            <span className="text-muted">{view.hand.length} cards</span>
          </span>
          {view.pendingDrawnCardId !== null
            ? <button className="btn btn-secondary" onClick={actions.pass}>Keep it</button>
            : <button className="btn btn-secondary" disabled={!yourTurn} onClick={actions.draw}>Draw</button>}
          {canCatch
            ? <button className="btn btn-primary" onClick={actions.catchCall}>Catch</button>
            : <button className="btn btn-primary" disabled={!canCall} onClick={actions.call}>Call “last card”</button>}
        </div>
      </div>

      {view.mustChooseColor && <ColorPicker title="The flip was wild — pick the color" onPick={actions.chooseColor} />}
      {wildCardId !== null && (
        <ColorPicker title="Pick the color" onPick={(c) => { actions.play(wildCardId, c); setWildCardId(null); }} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Table styling**

Append to `client/src/game.css`:

```css
.table-screen { min-height: 100dvh; display: flex; flex-direction: column; }
.table-felt {
  position: relative; flex: 1; margin: var(--space-4);
  display: grid; place-items: center;
}
.table-felt::before {
  content: ''; position: absolute; inset: 8%;
  border-radius: 50%; background: var(--felt);
  box-shadow: inset 0 0 0 10px rgb(46 43 37 / 0.07), var(--shadow-md);
}
.opp-slot { position: absolute; }
.opp-slot-top { top: 0; left: 50%; transform: translateX(-50%); }
.opp-slot-left { left: 0; top: 40%; }
.opp-slot-right { right: 0; top: 40%; }
.opp { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.opp-fan { display: flex; }
.opp-fan .cardface { margin-left: -14px; }
.opp-fan .cardface:first-child { margin-left: 0; }
.opp-pill {
  display: flex; align-items: center; gap: var(--space-2);
  background: var(--card-cream); border-radius: 999px;
  padding: var(--space-1) var(--space-3) var(--space-1) var(--space-1);
  box-shadow: var(--shadow-sm); outline: 2px solid transparent; outline-offset: 2px;
  transition: outline-color 0.25s;
}
.opp-active .opp-pill { outline-color: var(--color-accent); }
.stage { position: relative; display: flex; align-items: center; gap: var(--space-4); }
.live-dot { width: 16px; height: 16px; border-radius: 50%; transition: background 0.25s; }
.banner {
  position: absolute; bottom: 12%; left: 50%; transform: translateX(-50%);
  background: var(--card-cream); border-radius: 999px;
  padding: var(--space-2) var(--space-4); box-shadow: var(--shadow-sm);
  font-weight: 600; font-size: 14px; white-space: nowrap;
}
.hand-dock {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-6);
}
.hand { display: flex; justify-content: center; }
.hand .cardface { margin-left: -12px; transition: transform 0.2s; }
.hand .cardface:first-child { margin-left: 0; }
.hand-actions { display: flex; align-items: center; gap: var(--space-3); }

.cardface {
  padding: 0; border: 0; background: transparent; cursor: pointer;
  border-radius: 13px; background: var(--suit);
  box-shadow: var(--shadow-md); position: relative;
}
.cardface:disabled { cursor: default; opacity: 0.55; }
.cardface-playable { opacity: 1; }
.cardface-playable:not(:disabled):hover { transform: translateY(-10px); }
.cardface-raised { transform: translateY(-14px); outline: 3px solid var(--color-accent); outline-offset: 3px; }
.cardface-frame {
  position: absolute; inset: 6px; border-radius: 8px;
  border: 2px solid rgb(253 248 239 / 0.85);
  display: grid; place-items: center;
}
.cardface-oval {
  width: 58%; height: 60%; border-radius: 50%;
  background: var(--card-cream); transform: rotate(-22deg);
  display: grid; place-items: center;
}
.cardface-glyph {
  font-family: var(--font-heading); transform: rotate(22deg);
  color: var(--suit); font-size: 1.4em;
}
.cardface-sm { width: 30px; height: 44px; font-size: 10px; }
.cardface-md { width: 74px; height: 108px; font-size: 20px; }
.cardface-lg { width: 84px; height: 124px; font-size: 24px; }

.colorpicker-row { display: flex; gap: var(--space-3); justify-content: center; }
.colorpicker-dot {
  width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--card-cream);
  cursor: pointer; box-shadow: var(--shadow-sm);
}
.colorpicker-dot:hover { transform: scale(1.08); }
```

In `client/src/App.tsx`, replace the dump line with:

```tsx
  if (view.phase === 'lobby') return <Lobby />;
  if (view.phase === 'playing') return <Table />;
  return <pre style={{ padding: 24 }}>{JSON.stringify(view, null, 2)}</pre>; // Task 13 replaces
```

and add `import Table from './screens/Table';`.

- [ ] **Step 5: Verify manually — play a full round**

Two browsers, 2 players: deal, then play a complete round.
Check: only playable cards are clickable; draw puts a playable card on offer
  (raised, with a “Keep it” button); wilds open the color picker; skip/reverse/draw2
  behave; the banner tracks color and turn; “Call ‘last card’” arms at two cards;
  the opponent's Catch button appears when you forget to call.
The round should end on the JSON dump showing `"phase": "roundEnd"`.

- [ ] **Step 6: Commit**

```bash
git add client/src/components client/src/screens/Table.tsx client/src/App.tsx client/src/game.css
git commit -m "feat: table screen with felt, seats, hand, and turn actions"
```

---

### Task 13: Round over, pause overlay, reconnection polish

**Files:**
- Create: `client/src/screens/RoundOver.tsx`
- Create: `client/src/components/PauseOverlay.tsx`
- Modify: `client/src/screens/Table.tsx` (render the overlay), `client/src/App.tsx` (final routing), `client/src/game.css`

**Interfaces:**
- Consumes: `useStore()`; `Seat`/avatar styles from Tasks 11–12.
- Produces: the complete screen set; App.tsx has no remaining debug output.

- [ ] **Step 1: Round-over screen**

`client/src/screens/RoundOver.tsx`:

```tsx
import { useStore } from '../store';

export default function RoundOver() {
  const { view, actions } = useStore();
  if (!view) return null;
  const winner = view.seats.find((s) => s.seat === view.winnerSeat);
  const ranked = [...view.seats].sort((a, b) => a.cardCount - b.cardCount);
  return (
    <main className="screen">
      <div className="seat-avatar seat-avatar-big">{winner?.name[0]?.toUpperCase()}</div>
      <h1>{winner?.seat === view.yourSeat ? 'You take it' : `${winner?.name} takes it`}</h1>
      <table className="table roundover-table">
        <tbody>
          {ranked.map((s) => (
            <tr key={s.seat}>
              <td>{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</td>
              <td>{s.cardCount === 0 ? 'out' : `${s.cardCount} left`}</td>
              <td>{view.winTally[s.seat] ?? 0} {view.winTally[s.seat] === 1 ? 'win' : 'wins'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hand-actions">
        <a className="btn btn-secondary" href="/">Leave</a>
        <button className="btn btn-primary" onClick={actions.rematch}>Play again</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Pause overlay with the 2-minute continue-without gate**

`client/src/components/PauseOverlay.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useStore } from '../store';

const GRACE_MS = 120_000; // mirrors CONTINUE_GRACE_MS on the server

export default function PauseOverlay() {
  const { view, actions } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!view?.paused) return null;

  const awaySeat = view.seats.find((s) => !s.connected);
  const waitedMs = view.pausedSinceMs === null ? 0 : now - view.pausedSinceMs;
  const graceOver = waitedMs >= GRACE_MS;

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-title">Waiting for {view.pausedForName}…</div>
        <div className="dialog-body">
          Their seat is held — the game resumes the moment they reopen the link.
        </div>
        {graceOver && awaySeat && (
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => actions.continueWithout(awaySeat.seat)}>
              Continue without them
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire everything into Table and App**

In `client/src/screens/Table.tsx`: add `import PauseOverlay from '../components/PauseOverlay';`
  and render `<PauseOverlay />` as the last child of `<main className="table-screen">`.

`client/src/App.tsx`, final form of the routing tail (replace the dump line):

```tsx
  if (view.phase === 'lobby') return <Lobby />;
  if (view.phase === 'playing') return <Table />;
  return <RoundOver />;
```

with `import RoundOver from './screens/RoundOver';`.

Append to `client/src/game.css`:

```css
.seat-avatar-big { width: 74px; height: 74px; font-size: 32px; }
.roundover-table { max-width: 360px; }
```

- [ ] **Step 4: Verify manually**

Play a round to the end in two browsers: winner screen shows the ranking and tally;
  “Play again” deals a fresh round for both.
Close one browser mid-round: the other gets the pause overlay; reopen the link —
  the game resumes seamlessly.
To check the gate without waiting: temporarily set `GRACE_MS = 5_000` in
  `PauseOverlay.tsx` **and** `CONTINUE_GRACE_MS = 5_000` in `server/src/rooms.ts`,
  observe “Continue without them” working (2-player room → survivor wins), then
  **revert both constants before committing** (`git diff` must show only intended changes).

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat: round-over screen and disconnect pause overlay"
```

---

### Task 14: Mobile layout

**Files:**
- Modify: `client/src/screens/Table.tsx` (wrap opponent slots in a container)
- Modify: `client/src/game.css` (append the breakpoint)

**Interfaces:**
- Consumes: Task 12's Table markup and classes.
- Produces: the compact stacked layout from design screen 09 at ≤720 px.

- [ ] **Step 1: Add the wrapper**

In `Table.tsx`, wrap the opponent slots (leave the mapping itself unchanged):

```tsx
      <div className="opps">
        {opponents.map((s, i) => (
          <div key={s.seat} className={`opp-slot opp-slot-${slotNames[i]}`}>
            <Seat seat={s} active={view.turnSeat === s.seat} />
          </div>
        ))}
      </div>
```

Desktop keeps absolute positioning by making the wrapper transparent:

```css
.opps { display: contents; }
```

(add this line to `game.css` next to the existing `.opp-slot` rules).

- [ ] **Step 2: The breakpoint**

Append to `client/src/game.css`:

```css
@media (max-width: 720px) {
  .table-felt { margin: var(--space-2); }
  .table-felt::before { inset: 0; border-radius: var(--radius-lg); }
  .opps {
    display: flex; position: absolute; top: var(--space-2); left: 0; right: 0;
    justify-content: center; gap: var(--space-2); flex-wrap: wrap;
  }
  .opp-slot, .opp-slot-top, .opp-slot-left, .opp-slot-right {
    position: static; transform: none;
  }
  .opp-fan { display: none; }              /* pills only — counts carry the info */
  .stage { gap: var(--space-2); }
  .cardface-lg { width: 64px; height: 94px; font-size: 18px; }
  .cardface-md { width: 56px; height: 82px; font-size: 15px; }
  .hand { max-width: 100vw; overflow-x: auto; padding: var(--space-3) var(--space-2) 0; }
  .hand .cardface { margin-left: -8px; }
  .banner { bottom: 6%; font-size: 12px; }
  .hand-dock { padding-bottom: var(--space-3); }
  .hand-actions { flex-wrap: wrap; justify-content: center; }
}
```

- [ ] **Step 3: Verify manually**

Chrome devtools device mode (iPhone SE and a 400×800 custom size), one mobile + one
  desktop window in the same room: opponents collapse to a pill row on top, the hand
  scrolls horizontally without the page scrolling sideways, all buttons reachable,
  a full round is playable by touch.

- [ ] **Step 4: Commit**

```bash
git add client/src/screens/Table.tsx client/src/game.css
git commit -m "feat: compact mobile table layout"
```

---

### Task 15: Container build and deployment

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`
- Modify: `README.md` (status + run instructions)

**Interfaces:**
- Consumes: root `npm run build` (Task 1) which stages `client/dist` into `server/public`.
- Produces: a runnable image exposing port 3000; Fly.io config pinned to one always-on machine (in-memory rooms require a single instance).

- [ ] **Step 1: Dockerfile and .dockerignore**

`.dockerignore`:

```
node_modules
**/node_modules
**/dist
server/public
design
docs
.git
.superpowers
.remember
```

`Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
EXPOSE 3000
CMD ["node", "server/dist/server.js"]
```

- [ ] **Step 2: Build and smoke-test the image**

```bash
npm run build          # verify the local build stages server/public first
docker build -t ochre-eights .
docker run --rm -p 3000:3000 ochre-eights
```

In another terminal: `curl -s -X POST localhost:3000/api/rooms` → `{"code":"…"}`,
  and `curl -s localhost:3000/ | head -3` returns the SPA's HTML.
Then open `http://localhost:3000` in two browsers and play one quick round against
  the container. Stop the container.

- [ ] **Step 3: Fly.io config**

`fly.toml`:

```toml
app = "ochre-eights"
primary_region = "arn"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"   # in-memory rooms: the machine must stay up
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

Deploying is a user action (needs a Fly account):
  `fly launch --copy-config --no-deploy` once, then `fly deploy`.
Railway/Render work with the same Dockerfile unchanged.

- [ ] **Step 4: Update the README**

In `README.md`, replace the `**Status:** design phase — implementation not started yet.` line with:

```markdown
**Status:** playable. `npm install && npm run build && npm start -w server`,
  then open http://localhost:3000. For development: `npm run dev -w server`
  and `npm run dev -w client` (Vite on :5173 proxies to :3000).
```

- [ ] **Step 5: Final verification and commit**

```bash
npm test && npm run typecheck && npm run build
git add Dockerfile .dockerignore fly.toml README.md
git commit -m "feat: container build and Fly.io deployment config"
git push
```

---

## Plan Self-Review (completed)

- **Spec coverage:** engine rules → Tasks 3–6; personalized views / anti-cheat → Task 7;
    rooms, tokens, reconnection, continue-without, GC → Tasks 8–9; six screens + two states →
    Tasks 10–13 (Landing, HostLink, Join, Lobby, Table, RoundOver, pause overlay, not-found);
    mobile → Task 14; one-container deploy → Task 15; engine unit tests + one socket
    integration test, manual UI verification → matches the spec's testing section.
- **Known simplifications** (consistent with spec's out-of-scope list): no spectators, no
    timers, no scoring; `chooseColor` exists only for the first-flip wild; deck-and-discard
    both empty turns a draw into a pass.
- **Type consistency:** `RoomStateView`/event names defined once in Task 1 and consumed
    verbatim in Tasks 7, 9, 10, 12, 13; `CONTINUE_GRACE_MS` mirrored as `GRACE_MS` in
    `PauseOverlay.tsx` (client cannot import server code).
