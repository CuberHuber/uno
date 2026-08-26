import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type {
  CatchUpView, ClientToServerEvents, Effect, JoinAck, SeatRecord, SeatTransaction,
  ServerToClientEvents,
} from '@uno/shared';
import type { Analytics, CatchUpOutcome } from './analytics.js';
import type { RoomStore } from './rooms.js';
import type { ServerLimits } from './server.js';
import type { Visitor } from './umami.js';
import {
  parseAck, parseColor, parseJoin, parseNone, parsePin, parsePlay, parseRules, parseSeat,
  type Parsed,
} from './wire.js';

/** What a socket holds once it sits down; `socket.data` starts out as `{}`, so
 *  the partial is the honest type and `seated()` is the only way past it.
 *
 *  `code` and `token` keep their meaning for as long as the socket lives.
 *  `seat` does not: it is the seat *as of sitting down*, and the rematch
 *  compaction renumbers the table underneath it. Anything that needs the seat
 *  now asks `store.resume(code, token)` — the token is the identity that
 *  survives the renumbering. Nothing below reads `seat` for anything but the
 *  guard that says this socket sat down at all. */
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
    // The journal number the snapshots below are true as of. A snapshot is the
    // whole state, so a client that applied one holds everything up to this
    // number — which is exactly what it acknowledges. Without this the pointer
    // would only ever move on a reconnect, fall a whole game behind, and turn
    // every catch-up into `history_truncated`.
    const head = store.historyHead(code);
    for (const [seat, player] of room.players.entries()) {
      if (player.left || player.socketId === null) continue;
      const view = store.tryViewFor(code, seat);
      if (view === null) continue;
      io.to(player.socketId).emit('roomState', view);
      if (head.ok) io.to(player.socketId).emit('historyHead', { seq: head.seq });
    }
  };

  /** What a returning player missed, or nothing when there is nothing to say.
   *
   *  Called *before* the snapshot goes out, and that order is load-bearing: the
   *  snapshot carries `historyHead`, the client acknowledges it on arrival, and
   *  the pointer jumps to the head — erasing the very gap this describes.
   *
   *  Every transaction it returns came out of `store.historySince`, which
   *  projects onto the seat: other people's cards are structurally absent and
   *  the reader's own arrive in `yourCards`. There is no second path from the
   *  journal to a socket. */
  const catchUpFor = (code: string, seat: number, back?: { visitor?: Visitor }): CatchUpView | null => {
    const room = store.getRoom(code);
    const player = room?.players[seat];
    if (!room || !player) return null;
    const cursor = store.historyCursor(code, seat);
    if (!cursor.ok) return null;
    /** Measured only for an actual return. A fresh arrival starts level with
     *  the head by construction, so counting it would fill the series with
     *  gapless "returns" that never happened and hide the share that matters:
     *  how often a gap outran the journal. `back` is present exactly when the
     *  seat was retaken, and carries the visitor the event belongs to. */
    const served = (outcome: CatchUpOutcome, gap: number | null) => {
      if (back) analytics?.catchUpServed(outcome, gap, back.visitor);
    };
    // The roster is how a `playerId` gets a name. Players who have left stay in
    // it: a transaction they caused is still in the window, and their name is
    // still theirs. Identity here is the id — the seat is only where they sit
    // now, and before a rematch boundary the same number meant someone else.
    const seats: SeatRecord[] = room.players.map((p, i) => ({ seat: i, playerId: p.id, name: p.name }));
    const missed = store.historySince(code, seat, cursor.seq);
    if (missed.ok) {
      // The gap in transactions, which is what the journal's cap is measured
      // against. While the answer is `ok` no transaction in it was trimmed, so
      // this is exactly the number of entries below.
      if (missed.entries.length === 0) { served('empty', missed.seq - cursor.seq); return null; }
      served('delta', missed.seq - cursor.seq);
      // This assignment is the one place the server's own transaction type is
      // checked against the shape the protocol promises; a drift between them
      // stops the build rather than reaching a browser.
      const entries: SeatTransaction[] = missed.entries;
      return {
        seq: missed.seq, entries, truncated: false,
        crossedRebuild: missed.crossedRebuild, seats, you: player.id,
      };
    }
    if (missed.error !== 'history_truncated') {
      // A pointer the journal cannot even place: not a gap, a fault. The gap is
      // not measurable here, so nothing is fed to the distribution.
      served('failed', null);
      return null;
    }
    // Further behind than the journal reaches. The honest answer is the
    // snapshot plus a pointer moved up to the head — never a list with a hole
    // in it, which would read as "nothing else happened". The gap is still
    // known, and it is the reading that says whether the cap is set too low.
    served('truncated', missed.seq - cursor.seq);
    store.ackHistory(code, seat, missed.seq);
    return {
      seq: missed.seq, entries: [], truncated: true, crossedRebuild: false, seats, you: player.id,
    };
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
    // The client hears one thing — `moveRejected` with a reason — however the
    // frame died. What differs is who is being told: three refusals that used
    // to share one counter and answered three unrelated questions with one
    // number. The wire to the browser is unchanged; only the bookkeeping is.
    const refuse = (reason: string) => socket.emit('moveRejected', { reason });
    /** The rules said no: not your turn, that card does not match. Misclicks,
     *  read by whoever tunes the game. */
    const rejectMove = (reason: string) => {
      analytics?.moveRejected(reason);
      refuse(reason);
    };
    /** The frame was never a frame. A real client cannot send one, so this is
     *  read by whoever watches for someone prodding the socket. */
    const rejectWire = (reason: string) => {
      analytics?.wireRejected(reason);
      refuse(reason);
    };
    /** Over the per-socket action budget. Read by whoever sets the ceiling —
     *  a human at a table never reaches it. */
    const rejectBudget = () => {
      analytics?.actionBudgetExceeded();
      refuse('rate_limited');
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
        // Both series, and on purpose: the entry funnel counts every attempt it
        // turned away, and the wire series counts the ones that were not frames
        // at all. A mistyped code is a string and reaches the store — what is
        // refused here is a code that is not a string, or is longer than any
        // code — so the two questions do not contaminate each other.
        analytics?.wireRejected(parsed.error);
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
          const missed = catchUpFor(code, still.seat, { visitor });
          reply({ ok: true, seat: still.seat, token: held.token, roomName: roomName(code) });
          broadcast(code);
          if (missed) socket.emit('catchUp', missed);
          return;
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
      // A fresh arrival starts level with the head and so has nothing to catch
      // up on; only a seat retaken by token can. No branch needed for the
      // answer — the pointer already says which of the two this is — but the
      // telemetry does need it, on the same condition the join counter uses.
      const missed = catchUpFor(code, joined.seat, existing?.ok ? { visitor } : undefined);
      reply({ ok: true, seat: joined.seat, token: joined.token, roomName: roomName(code) });
      broadcast(code);
      // After the snapshot, deliberately: the state is already current when the
      // list of what was missed is read, so the list is history and not news.
      if (missed) socket.emit('catchUp', missed);
    }));

    /** One path for every seated event: seat, budget, payload, store — in that
     *  order, so a malformed or over-budget frame is refused before the store
     *  clones a game state for it. A throw degrades to a rejection message. */
    const handle = <T>(
      raw: unknown,
      parse: (p: unknown) => Parsed<T>,
      run: (at: Seated, value: T) => StoreResult,
      onOk?: (at: Seated, value: T) => void,
      /** `quiet` is for an event that changes nothing anyone can see. The
       *  acknowledgement is the only one: it moves a pointer, and broadcasting
       *  for it would send a snapshot, which carries a head, which is
       *  acknowledged — a loop that never stops. */
      opts: { quiet?: boolean } = {},
    ) => {
      const at = seated();
      if (!at) return;
      if (!limits.action.allow(socket.id)) return rejectBudget();
      const parsed = parse(raw);
      if (!parsed.ok) return rejectWire(parsed.error);
      try {
        const room = store.getRoom(at.code);
        const phaseBefore = room?.phase;
        const result = run(at, parsed.value);
        if (!result.ok) return rejectMove(result.error);
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
        if (opts.quiet) return;
        emitEffects(at.code, result.effects);
        broadcast(at.code);
      } catch (err) {
        log?.error({ err }, 'socket handler threw');
        // The store, not the frame and not the rules: it counts with the moves
        // because that is where it happened, and the log line above is what
        // anyone actually chases it with.
        rejectMove('server_error');
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

    socket.on('ackHistory', (p: unknown) => handle(
      p, parseAck,
      (at, v) => {
        // Not `at.seat`: the number a socket wrote down when it sat goes stale
        // the moment a rematch compacts the table, and a stale one would move
        // *another* player's pointer past a gap they still have. The token is
        // the identity that survives the compaction, so the seat is re-derived
        // from it on every acknowledgement.
        const here = store.resume(at.code, at.token);
        if (!here.ok) return here;
        return store.ackHistory(at.code, here.seat, v.seq);
      },
      undefined,
      { quiet: true },
    ));

    socket.on('disconnect', safely(() => {
      const at = seated();
      // Not `at.seat`. The number written down at sitting time means the seat
      // as of *then*, and the rematch compaction renumbers the table: after one
      // rematch that number is somebody else's seat, or no seat at all. The
      // acknowledgement handler already re-derives from the token, and for the
      // same reason both things here must — the report of where the session sat
      // and, worse, the seat this disconnect darkens. With a stale number the
      // socket-id pin below refuses to match and the leaver's seat stays lit
      // for good: never paused, never swept, a ghost at the table.
      const here = at ? store.resume(at.code, at.token) : null;
      const seat = here?.ok ? here.seat : null;
      analytics?.sessionEnded(socket.id, at && seat !== null ? { code: at.code, seat } : undefined);
      if (!at || seat === null) return;
      // Only the socket that still holds the seat may darken it: a phone that
      // moved Wi-Fi→LTE is already back on a new socket when this one's
      // disconnect finally lands, and the live seat must survive it.
      store.setConnection(at.code, seat, null, socket.id);
      broadcast(at.code);
    }));
  });
}
