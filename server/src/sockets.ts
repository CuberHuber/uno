import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { ClientToServerEvents, Effect, JoinAck, ServerToClientEvents } from '@uno/shared';
import type { Analytics } from './analytics.js';
import type { RoomStore } from './rooms.js';
import type { ServerLimits } from './server.js';
import {
  parseColor, parseJoin, parseNone, parsePin, parsePlay, parseRules, parseSeat, type Parsed,
} from './wire.js';

/** What a socket holds once it sits down; `socket.data` starts out as `{}`, so
 *  the partial is the honest type and `seated()` is the only way past it. */
interface Seated { code: string; seat: number; token: string }

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, Partial<Seated>>;

/** The shape every store call a listener may make answers in. */
type StoreResult = { ok: true; effects?: Effect[] } | { ok: false; error: string };

/** Only the method used here, so a Fastify log, a console, or nothing all fit. */
export interface SocketLog { error: (obj: object, msg: string) => void }

export function attachSockets(
  io: IO, store: RoomStore, limits: ServerLimits, analytics?: Analytics, log?: SocketLog,
): void {
  const broadcast = (code: string) => {
    const room = store.getRoom(code);
    if (!room) return;
    for (const [seat, player] of room.players.entries()) {
      if (player.left || player.socketId === null) continue;
      const view = store.tryViewFor(code, seat);
      if (view !== null) io.to(player.socketId).emit('roomState', view);
    }
  };
  const emitEffects = (code: string, effects: Effect[] | undefined) => {
    const room = store.getRoom(code);
    if (!room || !effects) return;
    for (const player of room.players) {
      if (player.left || player.socketId === null) continue;
      for (const e of effects) io.to(player.socketId).emit('effect', e);
    }
  };
  const roomName = (code: string): string => {
    const room = store.getRoom(code);
    const host = room?.players[room.hostSeat];
    return host && !host.left ? `${host.name}’s table` : 'Ochre Eights';
  };

  io.on('connection', (socket: Sock) => {
    // First x-forwarded-for hop, so server-truth events stitch into the same
    // Umami session the browser tracker creates behind the reverse proxy — and
    // so the rate limiters count the client, not the proxy: keyed on the proxy
    // every per-IP budget collapses into one global budget for the internet.
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || socket.handshake.address;
    const visitor = { ip, userAgent: socket.handshake.headers['user-agent'] };
    analytics?.sessionStarted(socket.id, visitor);

    const seated = (): Seated | null => {
      const held = socket.data;
      return typeof held.code === 'string' && typeof held.token === 'string' && typeof held.seat === 'number'
        ? { code: held.code, seat: held.seat, token: held.token }
        : null;
    };
    const reject = (reason: string) => {
      analytics?.moveRejected(reason);
      socket.emit('moveRejected', { reason });
    };
    /** Socket.IO runs listeners inside process.nextTick with no try/catch of
     *  its own, so an escaping throw is an exit(1) that takes every room on the
     *  instance with it. Listeners with work outside `handle` are wrapped. */
    const safely = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A): void => {
      try { fn(...args); } catch (err) { log?.error({ err }, 'socket listener threw'); }
    };

    socket.on('joinRoom', safely((p: unknown, ack?: (r: JoinAck) => void) => {
      // Both arguments are the client's to send: no payload leaves `p`
      // undefined, no callback leaves `ack` undefined — and since Socket.IO
      // appends the callback as the *last* argument, a client that sent only a
      // callback leaves it sitting where the payload should be.
      const answer = (typeof p === 'function' ? p : ack) as ((r: JoinAck) => void) | undefined;
      const reply = (r: JoinAck) => { if (typeof answer === 'function') answer(r); };
      const parsed = parseJoin(typeof p === 'function' ? undefined : p);
      if (!parsed.ok) {
        analytics?.joinFailed('', parsed.error, visitor);
        return reply({ ok: false, error: parsed.error });
      }
      const { code, name, token, pin } = parsed.value;
      const refuse = (reason: string) => {
        analytics?.joinFailed(code, reason, visitor);
        reply({ ok: false, error: reason });
      };
      if (!limits.join.allow(ip)) return refuse('rate_limited');

      const held = seated();
      if (held) {
        const still = store.resume(held.code, held.token);
        if (still.ok) {
          // One socket, one seat. A second join would take another seat and
          // orphan this one — disconnect only ever releases the last one — so
          // the only repeat allowed is retaking the seat already held. The held
          // token identifies it, not the client's: a double-clicked join sends
          // the token it read before the first ack came back.
          if (held.code !== code) return refuse('already_seated');
          socket.data = { code, seat: still.seat, token: held.token };
          store.setConnection(code, still.seat, socket.id);
          reply({ ok: true, seat: still.seat, token: held.token, roomName: roomName(code) });
          return broadcast(code);
        }
        socket.data = {}; // the held seat is gone: kicked, or the room was swept
      }

      const existing = token === undefined ? null : store.resume(code, token);
      let joined: { ok: true; seat: number; token: string } | { ok: false; error: string };
      if (existing?.ok && token !== undefined) {
        joined = { ok: true, seat: existing.seat, token };
      } else {
        // Wrong PINs burn a per-IP+room budget; a blocked key cools down a minute.
        const pinKey = `${ip}:${code}`;
        if (limits.pin.blocked(pinKey)) return refuse('rate_limited');
        const fresh = store.join(code, name, pin);
        if (!fresh.ok && fresh.error === 'wrong_pin') limits.pin.hit(pinKey);
        joined = fresh;
      }
      if (!joined.ok) return refuse(joined.error);
      socket.data = { code, seat: joined.seat, token: joined.token };
      store.setConnection(code, joined.seat, socket.id);
      if (!existing?.ok) analytics?.playerJoined(code, joined.seat);
      reply({ ok: true, seat: joined.seat, token: joined.token, roomName: roomName(code) });
      broadcast(code);
    }));

    /** One path for every seated event: seat, budget, payload, store — in that
     *  order, so a malformed or over-budget frame is refused before the store
     *  clones a game state for it. A throw degrades to a rejection message. */
    const handle = <T>(
      raw: unknown,
      parse: (p: unknown) => Parsed<T>,
      run: (at: Seated, value: T) => StoreResult,
      onOk?: (at: Seated, value: T) => void,
    ) => {
      const at = seated();
      if (!at) return;
      if (!limits.action.allow(socket.id)) return reject('rate_limited');
      const parsed = parse(raw);
      if (!parsed.ok) return reject(parsed.error);
      try {
        const room = store.getRoom(at.code);
        const phaseBefore = room?.phase;
        const result = run(at, parsed.value);
        if (!result.ok) return reject(result.error);
        // Rounds start and end only through phase flips, so watching the flip
        // here covers startGame, rematch, the winning play, and continueWithout.
        if (analytics && room && room.phase !== phaseBefore) {
          if (room.phase === 'playing') {
            if (phaseBefore === 'roundEnd') analytics.rematchStarted(room.code);
            analytics.roundStarted(room.code, room.players.filter((pl) => !pl.left).length, visitor);
          } else if (phaseBefore === 'playing' && room.phase === 'roundEnd') {
            analytics.roundFinished(room.code, room.game?.winner ?? null, visitor);
          }
        }
        onOk?.(at, parsed.value);
        emitEffects(at.code, result.effects);
        broadcast(at.code);
      } catch (err) {
        log?.error({ err }, 'socket handler threw');
        reject('server_error');
      }
    };

    socket.on('startGame', () => handle(null, parseNone, (at) => store.startGame(at.code, at.token)));
    socket.on('setRules', (p: unknown) => handle(
      p, parseRules,
      (at, v) => store.setRules(at.code, at.token, v.rules),
      (at, v) => analytics?.rulesChanged(at.code, v.rules),
    ));
    socket.on('setPin', (p: unknown) => handle(p, parsePin, (at, v) => store.setPin(at.code, at.token, v.pin)));
    socket.on('playCards', (p: unknown) => handle(p, parsePlay, (at, v) => store.act(
      at.code, at.token, { type: 'play', cardIds: v.cardIds, chosenColor: v.chosenColor },
    )));
    socket.on('drawCard', () => handle(null, parseNone, (at) => store.act(at.code, at.token, { type: 'draw' })));
    socket.on('passTurn', () => handle(null, parseNone, (at) => store.act(at.code, at.token, { type: 'pass' })));
    socket.on('chooseColor', (p: unknown) => handle(
      p, parseColor, (at, v) => store.act(at.code, at.token, { type: 'chooseColor', color: v.color }),
    ));
    socket.on('callLastCard', () => handle(null, parseNone, (at) => store.act(at.code, at.token, { type: 'callLastCard' })));
    socket.on('catchLastCard', () => handle(null, parseNone, (at) => store.act(at.code, at.token, { type: 'catchLastCard' })));
    socket.on('rematch', () => handle(null, parseNone, (at) => store.rematch(at.code, at.token)));
    socket.on('continueWithout', (p: unknown) => handle(
      p, parseSeat,
      (at, v) => store.continueWithout(at.code, at.token, v.seat),
      (at, v) => analytics?.playerKicked(at.code, v.seat),
    ));

    socket.on('disconnect', safely(() => {
      const at = seated();
      analytics?.sessionEnded(socket.id, at ? { code: at.code, seat: at.seat } : undefined);
      if (!at) return;
      // Only the socket that still holds the seat may darken it: a phone that
      // moved Wi-Fi→LTE is already back on a new socket when this one's
      // disconnect finally lands, and the live seat must survive it.
      store.setConnection(at.code, at.seat, null, socket.id);
      broadcast(at.code);
    }));
  });
}
