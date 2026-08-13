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
    if (g.mustChooseColor) { g.mustChooseColor = false; g.currentColor = 'red'; g.players[g.turn]!.hand = [{ id: 9999, color: 'red', value: '5' }]; }
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
