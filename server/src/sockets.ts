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
    socket.on('setRules', (p) => handle(() => store.setRules(seatOf().code, seatOf().token, p.rules)));
    socket.on('playCard', (p) => handle(() => store.act(seatOf().code, seatOf().token, { type: 'play', cardIds: [p.cardId], chosenColor: p.chosenColor })));
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
