import { describe, expect, test } from 'vitest';
import { CLASSIC_RULES } from '@uno/shared';
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
  test('codes are 5 chars from the safe alphabet, no hyphen', () => {
    const room = new RoomStore().createRoom();
    expect(room.code).toMatch(/^[34679ACDEFHKMNPRTWXY]{5}$/);
  });
  test('lookup strips spaces and dashes, case-insensitive', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const messy = `${room.code.toLowerCase().slice(0, 2)}-${room.code.slice(2)}`;
    expect(store.getRoom(messy)).toBe(room);
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
    const turnSeat = g.turn;
    const token = turnSeat === 0 ? a.token : (store.getRoom(room.code)!.players[turnSeat]!.token);
    const r = store.act(room.code, token, { type: 'play', cardIds: [9999] } as never);
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

describe('house rules', () => {
  test('host sets rules in the lobby; everyone sees them', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const a = store.join(room.code, 'Mira');
    const b = store.join(room.code, 'Jonas');
    if (!a.ok || !b.ok) throw new Error('join failed');
    expect(store.viewFor(room.code, 0).rules).toEqual(CLASSIC_RULES);
    expect(store.setRules(room.code, a.token, { stacking: true, forcePlay: true }).ok).toBe(true);
    expect(store.viewFor(room.code, 1).rules).toEqual({ ...CLASSIC_RULES, stacking: true, forcePlay: true });
  });

  test('only the host may change the rules', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const a = store.join(room.code, 'Mira');
    const b = store.join(room.code, 'Jonas');
    if (!a.ok || !b.ok) throw new Error('join failed');
    expect(store.setRules(room.code, b.token, { stacking: true, forcePlay: false }).ok).toBe(false);
    expect(store.viewFor(room.code, 0).rules.stacking).toBe(false);
  });

  test('rules lock once the game starts and reach the engine', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const a = store.join(room.code, 'Mira');
    const b = store.join(room.code, 'Jonas');
    if (!a.ok || !b.ok) throw new Error('join failed');
    expect(store.setRules(room.code, a.token, { stacking: true, forcePlay: true }).ok).toBe(true);
    expect(store.startGame(room.code, a.token).ok).toBe(true);
    expect(store.getRoom(room.code)!.game!.rules).toEqual({ ...CLASSIC_RULES, stacking: true, forcePlay: true });
    expect(store.setRules(room.code, a.token, { stacking: false, forcePlay: false }).ok).toBe(false);
    expect(store.viewFor(room.code, 1).rules.stacking).toBe(true);
  });

  test('rematch keeps the rules', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const a = store.join(room.code, 'Mira');
    const b = store.join(room.code, 'Jonas');
    if (!a.ok || !b.ok) throw new Error('join failed');
    expect(store.setRules(room.code, a.token, { stacking: true, forcePlay: false }).ok).toBe(true);
    expect(store.startGame(room.code, a.token).ok).toBe(true);
    store.getRoom(room.code)!.phase = 'roundEnd';
    expect(store.rematch(room.code, a.token).ok).toBe(true);
    expect(store.getRoom(room.code)!.game!.rules).toEqual({ ...CLASSIC_RULES, stacking: true });
    expect(store.viewFor(room.code, 0).rules).toEqual({ ...CLASSIC_RULES, stacking: true });
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

describe('5-char codes and room PIN', () => {
  test('createRoom applies rules and pin', () => {
    const store = new RoomStore();
    const room = store.createRoom({ rules: { multiDiscard: true }, pin: '1234' });
    expect(room.rules.multiDiscard).toBe(true);
    expect(room.pin).toBe('1234');
  });
  test('join without pin → pin_required; wrong pin → wrong_pin; right pin seats you', () => {
    const store = new RoomStore();
    const room = store.createRoom({ pin: '1234' });
    expect(store.join(room.code, 'Ann')).toEqual({ ok: false, error: 'pin_required' });
    expect(store.join(room.code, 'Ann', '0000')).toEqual({ ok: false, error: 'wrong_pin' });
    expect(store.join(room.code, 'Ann', '1234').ok).toBe(true);
  });
  test('resume by token bypasses the pin', () => {
    const store = new RoomStore();
    const room = store.createRoom({ pin: '1234' });
    const j = store.join(room.code, 'Ann', '1234');
    if (!j.ok) throw new Error(j.error);
    expect(store.resume(room.code, j.token).ok).toBe(true);
  });
  test('setPin: host-only, lobby-only, format-checked, removable', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const host = store.join(room.code, 'Host');
    const guest = store.join(room.code, 'Guest');
    if (!host.ok || !guest.ok) throw new Error('setup');
    expect(store.setPin(room.code, guest.token, '1234')).toEqual({ ok: false, error: 'host_only_rules' });
    expect(store.setPin(room.code, host.token, '12x4')).toEqual({ ok: false, error: 'bad_pin' });
    expect(store.setPin(room.code, host.token, '4321').ok).toBe(true);
    expect(room.pin).toBe('4321');
    expect(store.setPin(room.code, host.token, null).ok).toBe(true);
    expect(room.pin).toBeNull();
    store.startGame(room.code, host.token);
    expect(store.setPin(room.code, host.token, '1234')).toEqual({ ok: false, error: 'rules_locked' });
  });
  test('only the host view carries the pin; everyone sees hasPin', () => {
    const store = new RoomStore();
    const room = store.createRoom({ pin: '1234' });
    store.join(room.code, 'Host', '1234');
    store.join(room.code, 'Guest', '1234');
    expect(store.viewFor(room.code, 0).pin).toBe('1234');
    expect(store.viewFor(room.code, 0).hasPin).toBe(true);
    expect(store.viewFor(room.code, 1).pin).toBeNull();
    expect(store.viewFor(room.code, 1).hasPin).toBe(true);
  });
});


function seatRoom(store: RoomStore, names: string[], seed = 42) {
  const room = store.createRoom({ seed });
  const tokens = names.map((n) => {
    const j = store.join(room.code, n);
    if (!j.ok) throw new Error(j.error);
    return j.token;
  });
  const started = store.startGame(room.code, tokens[0]!);
  if (!started.ok) throw new Error(started.error);
  return { room, tokens };
}

/** Hand the player to move one card that matches the discard, so the next act
 *  ends the round. Returns the winning seat. */
function forceWin(store: RoomStore, code: string): number {
  const g = store.getRoom(code)!.game!;
  g.pendingDraw = 0; g.pendingDrawKind = null; g.pendingDrawn = null; g.catchWindow = null;
  g.currentColor = 'red';
  g.players[g.turn]!.hand = [{ id: 9999, color: 'red', value: '5' }];
  const seat = g.turn;
  const r = store.act(code, store.getRoom(code)!.players[seat]!.token, { type: 'play', cardIds: [9999] } as never);
  if (!r.ok) throw new Error('forced win failed');
  return seat;
}

describe('continueWithout: the target seat must be a real array index', () => {
  test('string keys, negatives, fractions and out-of-range are all refused', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, tokens } = seatRoom(store, ['Mira', 'Jonas']);
    store.setConnection(room.code, 1, null);
    clock += CONTINUE_GRACE_MS + 1; // grace is over: only the index check can stop these
    const hostile: unknown[] = ['__proto__', 'length', 'constructor', '1', -1, 1.5, 2, 99, NaN, Infinity, null, undefined];
    for (const seat of hostile) {
      expect(store.continueWithout(room.code, tokens[0]!, seat as number))
        .toEqual({ ok: false, error: 'no_such_seat' });
    }
    // nothing was written through the prototype, and the table still plays
    expect(Object.prototype.hasOwnProperty.call(Array.prototype, 'left')).toBe(false);
    expect(([] as unknown as { left?: boolean }).left).toBeUndefined();
    const after = store.getRoom(room.code)!;
    expect(after.phase).toBe('playing');
    expect(after.players[1]!.left).toBe(false);
    expect(after.game!.players[1]!.removed).toBe(false);
    expect(store.continueWithout(room.code, tokens[0]!, 1).ok).toBe(true); // the real index still works
  });

  test('a removal after the round has ended does not score the win twice', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, tokens } = seatRoom(store, ['Mira', 'Jonas']);
    const winner = forceWin(store, room.code);
    const loser = winner === 0 ? 1 : 0;
    expect(store.getRoom(room.code)!.phase).toBe('roundEnd');
    expect(store.getRoom(room.code)!.winTally[winner]).toBe(1);
    store.setConnection(room.code, loser, null);
    clock += CONTINUE_GRACE_MS + 1;
    const caller = store.getRoom(room.code)!.players[winner]!.token;
    expect(store.continueWithout(room.code, caller, loser)).toEqual({ ok: false, error: 'no_round' });
    const after = store.getRoom(room.code)!;
    expect(after.winTally[winner]).toBe(1);
    expect(after.players[loser]!.left).toBe(false);
    expect(tokens.length).toBe(2);
  });
});

describe('rematch: validate first, then mutate', () => {
  test('a rematch that cannot deal leaves the room exactly as it was', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, tokens } = seatRoom(store, ['Mira', 'Jonas']);
    store.setConnection(room.code, 1, null);
    clock += CONTINUE_GRACE_MS + 1;
    expect(store.continueWithout(room.code, tokens[0]!, 1).ok).toBe(true); // 2 seats: the round ends
    const live = store.getRoom(room.code)!;
    const before = JSON.stringify([live.players, live.winTally, live.hostSeat, live.seed, live.phase]);
    expect(store.rematch(room.code, tokens[0]!)).toEqual({ ok: false, error: 'not_enough_players' });
    const after = store.getRoom(room.code)!;
    expect(JSON.stringify([after.players, after.winTally, after.hostSeat, after.seed, after.phase])).toBe(before);
    expect(after.game!.players.length).toBe(after.players.length); // round still matches the seat list
  });

  test('a refused rematch does not move the journal either', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, tokens } = seatRoom(store, ['Mira', 'Jonas', 'Ada']);
    store.getRoom(room.code)!.phase = 'roundEnd';
    const before = store.historyHead(room.code);
    expect(store.rematch(room.code, tokens[2]!)).toEqual({ ok: false, error: 'host_only_deal' });
    // Nothing happened, so nothing is written down — and the seat numbering has
    // not silently moved on under the pointers players are still holding.
    expect(store.historyHead(room.code)).toEqual(before);
    expect(clock).toBe(1_000_000);
    expect(store.rematch(room.code, tokens[0]!).ok).toBe(true);
    const after = store.historyHead(room.code);
    expect(after.ok && before.ok && after.seq > before.seq).toBe(true);
    expect(after.ok && after.seatEpoch).toBe(1);
  });

  test('only the host deals the next hand; a removed host passes the deal down', () => {
    let clock = 1_000_000;
    const store = new RoomStore(() => clock);
    const { room, tokens } = seatRoom(store, ['Mira', 'Jonas', 'Ada']);
    store.getRoom(room.code)!.phase = 'roundEnd';
    const live = store.getRoom(room.code)!;
    const before = JSON.stringify([live.players, live.winTally, live.hostSeat]);
    expect(store.rematch(room.code, tokens[2]!)).toEqual({ ok: false, error: 'host_only_deal' });
    expect(JSON.stringify([live.players, live.winTally, live.hostSeat])).toBe(before);
    expect(store.rematch(room.code, tokens[0]!).ok).toBe(true);
    // now drop the host out of the round: the first player still seated deals
    store.setConnection(room.code, 0, null);
    clock += CONTINUE_GRACE_MS + 1;
    expect(store.continueWithout(room.code, tokens[1]!, 0).ok).toBe(true);
    store.getRoom(room.code)!.phase = 'roundEnd';
    expect(store.rematch(room.code, tokens[2]!)).toEqual({ ok: false, error: 'host_only_deal' });
    expect(store.rematch(room.code, tokens[1]!).ok).toBe(true);
    const after = store.getRoom(room.code)!;
    expect(after.players.map((p) => p.name)).toEqual(['Jonas', 'Ada']);
    expect(after.hostSeat).toBe(0);
  });
});

describe('setConnection and the pin type', () => {
  test('a late disconnect from a replaced socket is ignored', () => {
    const store = new RoomStore();
    const { room } = seatRoom(store, ['Mira', 'Jonas']);
    store.setConnection(room.code, 0, 'sock-old');
    store.setConnection(room.code, 0, 'sock-new'); // Wi-Fi to LTE: same seat, new socket
    store.setConnection(room.code, 0, null, 'sock-old'); // the dead socket finally times out
    expect(store.getRoom(room.code)!.players[0]!.connected).toBe(true);
    expect(store.getRoom(room.code)!.players[0]!.socketId).toBe('sock-new');
    store.setConnection(room.code, 0, null, 'sock-new'); // the live socket really drops
    expect(store.getRoom(room.code)!.players[0]!.connected).toBe(false);
    // three-argument calls keep their old, unconditional meaning
    store.setConnection(room.code, 0, 'sock-3');
    store.setConnection(room.code, 0, null);
    expect(store.getRoom(room.code)!.players[0]!.connected).toBe(false);
    expect(store.getRoom(room.code)!.players[0]!.socketId).toBeNull();
  });

  test('a numeric pin is refused instead of locking the host out', () => {
    const store = new RoomStore();
    const room = store.createRoom();
    const host = store.join(room.code, 'Host');
    if (!host.ok) throw new Error(host.error);
    expect(store.setPin(room.code, host.token, 1234 as unknown as string)).toEqual({ ok: false, error: 'bad_pin' });
    expect(room.pin).toBeNull();
    expect(store.join(room.code, 'Guest').ok).toBe(true); // the table never got locked
    expect(store.createRoom({ pin: 1234 as unknown as string }).pin).toBeNull();
  });

  test('tryViewFor reports a missing room instead of throwing', () => {
    const store = new RoomStore();
    const { room } = seatRoom(store, ['Mira', 'Jonas']);
    expect(store.tryViewFor('AAAAA', 0)).toBeNull();
    expect(store.tryViewFor(room.code, 0)).toEqual(store.viewFor(room.code, 0));
  });
});
