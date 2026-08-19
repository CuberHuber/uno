import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import type { Analytics } from './analytics.js';
import type { RoomStore } from './rooms.js';
import type { ServerLimits } from './server.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

export function attachSockets(io: IO, store: RoomStore, limits: ServerLimits, analytics?: Analytics): void {
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
    analytics?.sessionStarted(socket.id);
    const seatOf = () => socket.data as { code: string; seat: number; token: string };

    socket.on('joinRoom', (p, ack) => {
      const ip = socket.handshake.address;
      const refuse = (reason: string) => {
        analytics?.joinFailed(p.code, reason);
        ack({ ok: false, error: reason });
      };
      if (!limits.join.allow(ip)) return refuse('rate_limited');
      const existing = p.token ? store.resume(p.code, p.token) : { ok: false as const, error: '' };
      let joined;
      if (existing.ok) {
        joined = { ok: true as const, seat: existing.seat, token: p.token! };
      } else {
        // Wrong PINs burn a per-IP+room budget; a blocked key cools down a minute.
        const pinKey = `${ip}:${p.code.toUpperCase()}`;
        if (limits.pin.blocked(pinKey)) return refuse('rate_limited');
        joined = store.join(p.code, p.name ?? 'Player', p.pin);
        if (!joined.ok && joined.error === 'wrong_pin') limits.pin.hit(pinKey);
      }
      if (!joined.ok) return refuse(joined.error);
      socket.data = { code: p.code, seat: joined.seat, token: joined.token };
      store.setConnection(p.code, joined.seat, socket.id);
      const room = store.getRoom(p.code)!;
      if (!existing.ok) analytics?.playerJoined(room.code, joined.seat);
      ack({ ok: true, seat: joined.seat, token: joined.token, roomName: `${room.players[room.hostSeat]!.name}’s table` });
      broadcast(p.code);
    });

    const handle = (
      fn: () => { ok: boolean; error?: string; effects?: never[] } | { ok: boolean; error?: string },
      onOk?: () => void,
    ) => {
      const { code } = seatOf();
      if (!code) return;
      const room = store.getRoom(code);
      const phaseBefore = room?.phase;
      const result = fn() as { ok: boolean; error?: string; effects?: never[] };
      if (!result.ok) {
        analytics?.moveRejected(result.error ?? 'rejected');
        socket.emit('moveRejected', { reason: result.error ?? 'rejected' });
        return;
      }
      // Rounds start and end only through phase flips, so watching the flip
      // here covers startGame, rematch, the winning play, and continueWithout.
      if (analytics && room && room.phase !== phaseBefore) {
        if (room.phase === 'playing') {
          if (phaseBefore === 'roundEnd') analytics.rematchStarted(room.code);
          analytics.roundStarted(room.code, room.players.filter((pl) => !pl.left).length);
        } else if (phaseBefore === 'playing' && room.phase === 'roundEnd') {
          analytics.roundFinished(room.code, room.game?.winner ?? null);
        }
      }
      onOk?.();
      emitEffects(code, result.effects);
      broadcast(code);
    };

    socket.on('startGame', () => handle(() => store.startGame(seatOf().code, seatOf().token)));
    socket.on('setRules', (p) => handle(
      () => store.setRules(seatOf().code, seatOf().token, p.rules),
      () => analytics?.rulesChanged(seatOf().code, p.rules),
    ));
    socket.on('setPin', (p) => handle(() => store.setPin(seatOf().code, seatOf().token, p.pin)));
    socket.on('playCards', (p) => handle(() => store.act(seatOf().code, seatOf().token, { type: 'play', cardIds: p.cardIds, chosenColor: p.chosenColor })));
    socket.on('drawCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'draw' })));
    socket.on('passTurn', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'pass' })));
    socket.on('chooseColor', (p) => handle(() => store.act(seatOf().code, seatOf().token, { type: 'chooseColor', color: p.color })));
    socket.on('callLastCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'callLastCard' })));
    socket.on('catchLastCard', () => handle(() => store.act(seatOf().code, seatOf().token, { type: 'catchLastCard' })));
    socket.on('rematch', () => handle(() => store.rematch(seatOf().code, seatOf().token)));
    socket.on('continueWithout', (p) => handle(
      () => store.continueWithout(seatOf().code, seatOf().token, p.seat),
      () => analytics?.playerKicked(seatOf().code, p.seat),
    ));

    socket.on('disconnect', () => {
      analytics?.sessionEnded(socket.id);
      const { code, seat } = seatOf();
      if (!code) return;
      store.setConnection(code, seat, null);
      broadcast(code);
    });
  });
}
