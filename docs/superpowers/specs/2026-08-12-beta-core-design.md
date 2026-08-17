# Ochre Eights beta — roadmap and core design spec (engine 2.0 + rooms)

Date: 2026-08-12.
Status: design approved in brainstorming; this document pending user review.
Builds on: `2026-08-10-uno-online-design.md` (the MVP spec, still authoritative where not superseded here).

## Beta roadmap (approved)

The beta is decomposed into six sub-projects.
Each one gets its own spec → plan → implementation cycle.
This spec covers **A** only; the roadmap and scope decisions below are recorded so later specs inherit them.

| # | Sub-project | Contents | Depends on |
|---|---|---|---|
| A | **Core: engine 2.0 + rooms** | rule modes with explanations, 5-char room code, optional PIN | — |
| B | **Positioning + landing** | audience/message, promo page, rule bullets, GIF demo, create/join entry | A (rule texts), Claude Design (GIF) |
| C | **Liveliness** | event sounds, background music (user-gesture gated) | — |
| E | **Onboarding** | one big rules slide before the game, in-game help (hidden by default) | A (rule texts) |
| D | **Social** | per-game metrics → end-of-game nicknames and podium | A |
| F | **Production** | security, observability, Timeweb deploy | cross-cutting |

Approved order: **A → B → E → C → D**, with F running cross-cutting
  (rate limiting and logging land with the features; a final security/observability audit gates the beta release).

### Beta scope decisions

| Topic | Decision |
|---|---|
| Background music | In beta; starts only from an explicit user gesture (browser autoplay policy) |
| Metrics and nicknames | In beta; in-room memory only, no accounts, no database |
| Vibration | Deferred past beta |
| Voice chat | Deferred past beta (v1.1); approach already chosen, see below |
| UI language | Both Russian and English (lightweight i18n, see below) |

**Voice chat (v1.1 note, recorded for later).**
WebRTC with a TURN server is rejected for now: Russian mobile operators sit behind CGNAT,
  where P2P without TURN fails often, and TURN is a second service to run.
Chosen approach: server relay over the existing Socket.IO connection —
  `getUserMedia` capture (built-in echo cancellation), Opus chunks of 100–250 ms,
  server fans out to the room, client keeps a small jitter buffer.
Cost: TCP head-of-line latency on lossy networks (up to ~500–800 ms) and a WASM Opus codec
  (AudioWorklet) for cross-browser encode/decode, since Safari's MediaRecorder speaks AAC, not webm/opus.
Bandwidth is trivial: a 4-player room where everyone talks is ~400 kbit/s through the server.

## Sub-project A: decision log

| Topic | Decision |
|---|---|
| Rule set | Four host toggles: `stacking` (strict), `forcePlay`, `drawToMatch`, `multiDiscard`; all default off = classic rules |
| Stacking semantics | **Changed from MVP**: +2 answers only +2, +4 answers only +4 (today any +2/+4 answers any pot); color still irrelevant |
| Seven-Zero, Jump-In | Rejected |
| Multi-discard | Same value, any colors, **number cards only**; first card must be playable; last card sets the color |
| Room code | Single 5-character code replaces the `XXXX-XXXX` format |
| Room password | Optional 4-digit PIN, set by the host |
| Engine architecture | Keep the pure reducer with per-rule conditionals; add a declarative rules catalog in `shared/` as the single source of rule texts |
| Plugin-style rules engine | Rejected — over-engineering for four toggles; would churn 120 green tests |
| i18n | Russian + English dictionaries, no i18n library |
| Visual design | The imported Claude Design references are the finished design — implement them as-is, do not reinvent: `design/Ochre Eights - Full Game.dc.html` (the interactive table with final animations) and `design/Ochre Eights - Card Set.dc.html` (the full card set), both on the Organic DS under `design/_ds/` |

## Rule semantics (engine 2.0)

All four rules are independent host toggles, locked at deal, persisted across rematch
  (the existing `setRules` behavior).

### 1. `stacking` — pass the penalty on (semantics tightened)

A pending +2 pot may be answered **only with another +2**; a pending +4 pot **only with another +4**.
Color is irrelevant for the answer, as before.
The pot accumulates in `pendingDraw`; a player who cannot or will not answer takes the whole pot
  and loses the turn.
A round never opens on a pot: only a number card may open one (amended 2026-08-17, see below),
  so the first pot of a round is always one a player put there.
This replaces the current mixed behavior (`game.ts` today accepts any +2/+4 on any pot).

### 2. `forcePlay` — unchanged

A drawn playable card is played immediately when on;
  when off the player chooses to play it or keep it and pass.

### 3. `drawToMatch` — new

When the player cannot or will not play, drawing replaces the classic "draw exactly one":
  the player draws until the first playable card arrives.
Interactions:

- The arrived playable card follows `forcePlay`:
    on → it is played immediately; off → the player chooses to play it or keep it and pass.
- Penalty draws are exact counts: the stacking pot and Draw 2/4 effects never draw-to-match.
- If the draw pile and the reshuffleable discard are both exhausted (all cards in hands),
    drawing stops and the turn passes.
  This is the only case under `drawToMatch` where a turn ends with no card played and no playable card drawn.

### 4. `multiDiscard` — new

One turn may discard **several cards of the same value**, any colors, **number cards only (0–9)**.
The first card of the stack must be playable by the normal rules; the last card sets the current color.
Interactions:

- Emptying the hand with a stack wins the round, exactly like a single card.
- If one card remains after a stack, the last-card call/catch window works as today.
- No interaction with stacking pots: pots are answered with a single +2/+4, which are not number cards.

## Dealing (amended 2026-08-17)

Dealing is a phase of its own, run **before** the round begins: shuffle the deck,
  deal seven to each seat, then turn cards over until a number appears.
**Only a number card may open a round.**
Anything else turned over is buried at the bottom of the draw pile — it stays in play,
  it just does not get to be the opener — and the next card is turned over instead.

This supersedes the MVP spec's first-flip rule, where a flipped action card took effect
  on the starting player and only a Wild Draw 4 was buried.
The rule it replaces is gone in every combination: no opening penalty, no opening skip,
  no reversed direction before anyone has played, no colour choice owed at the table.

**The deal does not reach into the round.**
However many cards it had to dig through, and whichever house rules the host switched on,
  the position it hands over is always the same:
  seat 0 to act, play running forward, the discard's own colour current,
  `pendingDraw` 0, `pendingDrawKind` and `pendingDrawn` null, `mustChooseColor` false,
  and seven cards in every hand.
This invariant is what makes the phase safe to animate: the client may take as long as it
  likes showing the shuffle and the deal, because there is no opening state to get wrong.

**Presentation.**
The deal plays as an animation before the round: cards fly from the pile to each seat,
  then the opening card turns over.
It is pure presentation over state the server has already settled in one atomic
  `createGame` — the client animates a result, it never drives it, and no protocol event
  reports the burials.
The animation runs on entering a round (lobby → playing, and again on rematch);
  a player reconnecting into a round already in progress skips straight to the table.

## Rules catalog (`shared/src/rulesCatalog.ts`)

The single source of rule metadata and prose, consumed by:
  the room-creation toggles, the lobby chips, the pre-game rules slide (E),
  the in-game help (E), and the landing rule bullets (B).

```ts
interface RuleInfo {
  id: keyof Rules;                     // 'stacking' | 'forcePlay' | 'drawToMatch' | 'multiDiscard'
  title:   { ru: string; en: string }; // e.g. «Перевод штрафа» / "Pass the penalty"
  tagline: { ru: string; en: string }; // one-line thesis: chips, landing bullets
  details: { ru: string; en: string }; // full explanation: create screen, help, slide
  default: boolean;                    // false everywhere = classic
}
export const RULES_CATALOG: RuleInfo[];
```

Rule prose is written once, here, in both languages.

## Protocol changes (`shared/src/types.ts`)

- `Rules` grows to four booleans; `CLASSIC_RULES` keeps all off.
- `playCard({ cardId, chosenColor? })` becomes **`playCards({ cardIds: number[], chosenColor? })`**;
    a single card is an array of one.
  Server validation: with `multiDiscard` off the array length must be 1;
    with it on, all cards must be number cards of one value and the first must be playable.
- `joinRoom` gains `pin?: string`; `JoinAck` gains the `pin_required` and `wrong_pin` error codes.
- `RoomStateView` carries the four-field `rules` and a new `hasPin: boolean`
    so the join screen knows to ask for a PIN.
- `POST /api/rooms` accepts `{ rules?, pin? }` and returns the 5-character code.
- `Effect` for a multi-discard play carries the whole stack so the client can animate it as one throw.

## Room codes

Five characters from an alphabet that strips look-alikes and sound-alikes:
  Latin capitals + digits minus `0 O Q`, `1 I L`, `5 S`, `8 B`, `2 Z`, `U V`, `G J`.
The exact alphabet is `3 4 6 7 9 A C D E F H K M N P R T W X Y` — 20 symbols, 20⁵ ≈ 3.2 M codes:
  brute force is impractical under the rate limits below,
  and collisions are negligible at this scale.
Input is case-insensitive; spaces and dashes are stripped.
The share link stays `/r/CODE`.
Rooms are ephemeral, so the format change needs no migration.

## Room password (PIN)

The host may set a 4-digit PIN at creation or in the lobby (host-only, editable until deal, removable).
A joiner who arrives by link or code at a PIN-protected room gets a PIN screen with a numeric keypad.
The PIN is stored in room memory as plain text — a deliberate call:
  it is an ephemeral, low-stakes secret for a room that lives hours,
  and brute force is handled by rate limiting, not by hashing.

## Anti-abuse (in-memory counters; the single-instance model makes this sound)

| Action | Limit |
|---|---|
| `POST /api/rooms` | 10/min per IP |
| Join attempts (code lookup) | 20/min per IP |
| Wrong PIN | 5/min per IP+room, then a 60 s cooldown |

## i18n

No library.
`client/src/i18n.ts` holds UI-string dictionaries for `ru` and `en`;
  the rules catalog carries its own two-language prose.
Default locale comes from `navigator.language`; a manual switcher in the header persists to localStorage.
Server-sent rejection reasons are typed codes; the client renders them through the dictionary.

## UI changes

- **Create room**: four toggles, each with title + tagline and an expandable full explanation ("?"),
    all from the catalog; below them an optional 4-digit PIN field.
- **Lobby**: host sees the same toggles and the PIN (editable until deal);
    everyone else sees chips of the enabled rules.
- **Join**: a 5-character code field; when the join ack answers `pin_required`,
    a numeric-keypad PIN screen appears and the join is retried with the PIN.
  (`hasPin` in `RoomStateView` serves already-seated players, e.g. the host's lobby UI.)
- **Table, multi-discard**: tapping a card selects it;
    with `multiDiscard` on, other playable cards of the same value highlight for adding to the stack,
    and a "Discard N" button plays them together.
  A single tap keeps working exactly as today.
- **Table, draw-to-match**: the Draw button issues **one** action;
    the server draws to the first playable card atomically and emits effects with the drawn count,
    which the client animates as a series.
  Mid-draw reconnects are impossible by construction.
- **Language switcher** in the header (landing and lobby).
- Animation and visual design of these states are already decided:
    follow `design/Ochre Eights - Full Game.dc.html` and `design/Ochre Eights - Card Set.dc.html`
    (imported 2026-08-12) — the design is finished, do not reinvent it.

## Error handling

Invalid stacks, wrong PINs, and rate-limit cooldowns come back as typed reason codes
  in `moveRejected` / `JoinAck`; the client renders localized messages.
Everything else keeps the MVP model: the server view is authoritative,
  invalid intents are rejected without state change.

## Testing

The existing 120 tests must stay green with all rules off — classic behavior does not change.
New engine tests (seeded decks, pure reducer):

- Strict stacking: a +4 on a +2 pot rejects, and vice versa; pots accumulate and pay out.
- `drawToMatch`: stops at the first playable; both `forcePlay` branches;
    draw pile + discard exhaustion passes the turn.
- `multiDiscard`: rejects action cards, mixed values, and an unplayable first card;
    the last card sets the color; winning by stack; the catch window after a stack.
- Rooms: PIN accept/reject/absent, rate-limit cooldowns, 5-char code format and alphabet.
- Sockets: one integration test driving `playCards` end to end.
- Dealing: the opening card is always a number; a run of specials is buried in the order
    it was turned over and the deck still holds 108 cards; the opening position is
    identical with every house rule on.

## Out of scope for sub-project A

The landing page (B), sounds and music (C), the rules slide and help (E),
  metrics and nicknames (D), the final security/observability audit and Timeweb deploy (F),
  voice chat and vibration (post-beta), accounts, persistence, and turn timers.
