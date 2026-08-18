# Ochre Eights — sub-project E: explaining the rules

Date: 2026-08-18.
Status: scope decided; open questions listed at the end.
Belongs to: sub-project **E** of `2026-08-12-beta-core-design.md`.

Two surfaces, one body of prose: **a rules slide before the round** and
  **in-game help, hidden until asked for**.

## The problem worth naming

Everyone at the table thinks they know UNO, and no two of them agree.
The gap is never the matching rule — it is the house rules, which differ by household,
  and the places where Ochre Eights departs from the official game.
So the explanation is not a tutorial. It is a **short, shared agreement** about what
  this table does, read in the ten seconds before the deal.

That framing sets the rule for everything below: explain what is in play at *this* table,
  nothing else. A player whose host never switched on `stacking` should never read about pots.

## The prose gap to close first

`shared/src/rulesCatalog.ts` already carries the four house rules —
  `title` / `tagline` / `details`, ru and en, one source feeding the create screen,
  the lobby chips and (soon) the landing.

It carries **nothing about the base game**. E cannot be built on a catalog that omits
  matching, the action cards, the last-card call, and the number-only opening.

So the first piece of work is a second catalog beside it, same shape, same file:

```ts
export interface BasicInfo {
  id: 'match' | 'actions' | 'wilds' | 'draw' | 'lastCard' | 'opening';
  title:   { ru: string; en: string };
  tagline: { ru: string; en: string };  // one line, for the slide
  details: { ru: string; en: string };  // full text, for help
}
export const BASICS_CATALOG: readonly BasicInfo[];
```

Six entries:

| id | Covers |
|---|---|
| `match` | Colour, number or symbol; wilds always playable |
| `actions` | Skip, Reverse (and its two-player behaviour), Draw 2 |
| `wilds` | Wild and Wild Draw 4, choosing a colour, no challenge |
| `draw` | Cannot play → draw one; play it or pass |
| `lastCard` | Calling before your final card; the catch window; the two-card penalty |
| `opening` | **A round always opens on a number card** — the departure from official UNO |

`opening` earns its own entry rather than a footnote: it is the rule a UNO veteran will
  notice is missing and quietly assume is a bug.

## Surface 1 — the slide before the round

One screen, shown between the lobby and the table when the host deals.

- **Basics on one side, this table's house rules on the other.** Taglines only —
    six lines and up to four lines, never a wall of text.
- **Only enabled house rules appear.** All four off shows a single "classic rules" line.
    A rule that is on is stated in the affirmative, never as "X is enabled".
- **The `opening` line is always present**, because it always applies.
- Dismiss with one obvious control. It is not a carousel and has no steps —
    a second screen would be a second thing to dismiss.
- Shown **once per browser per room**, remembered in `localStorage`;
    a rematch does not show it again, a new room does.
    A player who joins mid-round never sees it — they get help instead.
- Every string comes from the two catalogs, localised through the existing locale context.

The slide must not delay anyone who does not want it. The table finishes loading behind it,
  and dismissing is instant — no animation the impatient have to sit through.

## Surface 2 — in-game help, hidden by default

A "?" affordance at the table, off to the side, opening a sheet over the felt.

- **Never opens on its own.** No first-run popover, no tooltip pointing at it.
- Contents in this order: this table's active house rules (`details`, not `tagline` —
    the player is here because the one-liner was not enough), then the basics.
- The game keeps running underneath; the sheet does not pause anyone's turn or hide whose
    turn it is. Closing returns to exactly the same table state.
- Reachable by keyboard, dismissible with Escape, focus returned where it came from.

## What is deliberately not built

- **No interactive tutorial, no practice hand, no bot to play against.** A round takes
    five minutes with people you already invited; a tutorial is a longer detour than
    the game itself.
- **No rules search, no glossary, no printable page.** Ten rules do not need an index.
- **No per-rule illustrations in v1.** If a rule needs a picture to land, the wording is
    wrong — fix the wording first. The landing's clips (sub-project B) already carry the
    visual load for anyone who wants to watch the game move.

## Shared prose, four consumers

After E, catalog prose feeds: the create screen and lobby (already), the landing's
  house-rules section (B), the slide and the help (E).
Writing a rule once and rendering it four ways is the whole point — a rule reworded in the
  engine cannot leave a stale explanation behind it.

## Testing

- `BASICS_CATALOG` has all six ids, with both locales non-empty on every field —
    a unit test in `shared`, mirroring the existing `rulesCatalog.test.ts`.
- The slide renders only the enabled house rules: all-off shows the classic line;
    one on shows exactly one.
- The `localStorage` gate: shown once, not again on rematch, shown again for a new room.
- Help opens and closes without touching game state.

## Open questions

- Does the slide block the deal, or does the host deal and the slide overlay a table that
    is already live behind it? The second is faster but risks someone dismissing late and
    finding a turn already gone.
- Should the host see the slide at all — they just picked the rules on the create screen.
- Is the `opening` entry enough of a "we differ from official UNO" note, or does the slide
    want one explicit line saying so?
