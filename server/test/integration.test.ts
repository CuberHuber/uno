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
