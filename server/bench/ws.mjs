// Socket.io bot swarm: N tables of bots join, deal, and play real rounds
// against a live server, reporting throughput and broadcast latency.
//   npm run bench:ws          (env: BASE_URL, TABLES, SEATS, DURATION seconds)
// Beyond a couple of tables the default per-IP limits kick in, so start the
// server under test with RATE_LIMITS=off.
import { io as connect } from 'socket.io-client';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const TABLES = Number(process.env.TABLES ?? 10);
const SEATS = Math.min(4, Math.max(2, Number(process.env.SEATS ?? 2)));
const DURATION_S = Number(process.env.DURATION ?? 30);

const stats = { actions: 0, rejected: 0, rounds: 0, samples: [] };

// Approximation of the shared isPlayable — good enough for a bot that treats
// a rejection as "try the next card, then draw".
function seemsPlayable(card, top, currentColor) {
  if (card.value === 'wild' || card.value === 'wild4') return true;
  if (currentColor !== null && card.color === currentColor) return true;
  return top !== null && card.value === top.value;
}

function send(state, event, payload) {
  stats.actions += 1;
  state.pendingAt = performance.now();
  if (payload === undefined) state.sock.emit(event);
  else state.sock.emit(event, payload);
}

function act(state, afterReject = false) {
  const v = state.view;
  if (!v || v.phase !== 'playing' || v.paused || v.turnSeat !== v.yourSeat) return;
  if (v.mustChooseColor) return send(state, 'chooseColor', { color: 'red' });
  if (v.pendingDrawnCardId !== null) {
    if (afterReject) return send(state, 'passTurn');
    return send(state, 'playCards', { cardIds: [v.pendingDrawnCardId], chosenColor: 'red' });
  }
  const card = v.hand.find((c) => !state.tried.has(c.id) && seemsPlayable(c, v.topCard, v.currentColor));
  if (card) {
    state.tried.add(card.id);
    const wild = card.value === 'wild' || card.value === 'wild4';
    return send(state, 'playCards', { cardIds: [card.id], chosenColor: wild ? 'red' : undefined });
  }
  send(state, 'drawCard');
}

function seatBot(code, name) {
  const sock = connect(base, { transports: ['websocket'] });
  const state = { sock, view: null, tried: new Set(), pendingAt: 0, prevPhase: null, nudge: null };
  sock.on('roomState', (view) => {
    if (state.pendingAt) {
      stats.samples.push(performance.now() - state.pendingAt);
      state.pendingAt = 0;
    }
    if (view.turnSeat !== state.view?.turnSeat) state.tried.clear();
    // The host counts finished rounds (once per table) and deals the rematch.
    if (view.yourSeat === 0 && state.prevPhase === 'playing' && view.phase === 'roundEnd') {
      stats.rounds += 1;
      setTimeout(() => sock.emit('rematch'), 50);
    }
    state.prevPhase = view.phase;
    state.view = view;
    act(state);
  });
  sock.on('moveRejected', () => {
    stats.rejected += 1;
    act(state, true);
  });
  // Belt and braces: if a bot ever misses its cue, re-decide on a timer.
  state.nudge = setInterval(() => act(state), 1500);
  return new Promise((resolve, reject) => {
    sock.emit('joinRoom', { code, name }, (r) => (r.ok ? resolve(state) : reject(new Error(r.error))));
  });
}

const tables = [];
for (let t = 0; t < TABLES; t++) {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  if (res.status === 429) {
    console.error('Rate limited creating rooms — start the server with RATE_LIMITS=off.');
    process.exit(1);
  }
  const { code } = await res.json();
  const bots = [];
  for (let i = 0; i < SEATS; i++) {
    bots.push(await seatBot(code, `Bot ${t + 1}.${i + 1}`).catch((e) => {
      console.error(`join failed on table ${t + 1}: ${e.message} (RATE_LIMITS=off?)`);
      process.exit(1);
    }));
  }
  bots[0].sock.emit('startGame');
  tables.push({ code, bots });
}

console.log(`Playing ${TABLES} tables × ${SEATS} bots against ${base} for ${DURATION_S}s …`);
await new Promise((r) => setTimeout(r, DURATION_S * 1000));

for (const { bots } of tables) {
  for (const b of bots) { clearInterval(b.nudge); b.sock.disconnect(); }
}

stats.samples.sort((a, b) => a - b);
const pct = (p) => (stats.samples.length === 0 ? '—'
  : `${(stats.samples[Math.min(stats.samples.length - 1, Math.floor(stats.samples.length * p))]).toFixed(1)} ms`);
console.log(`rounds finished   ${stats.rounds}`);
console.log(`actions sent      ${stats.actions} (${(stats.actions / DURATION_S).toFixed(1)}/s)`);
console.log(`moves rejected    ${stats.rejected}`);
console.log(`action→state lag  p50 ${pct(0.5)}  p95 ${pct(0.95)}  max ${pct(1)}`);
process.exit(0);
