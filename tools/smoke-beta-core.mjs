// Scripted smoke for sub-project A (beta core), Task 14 step 2.
// Drives the BUILT server end to end on an ephemeral port: room creation with
// rules + PIN, the pin_required -> wrong_pin -> seated gate, the deal, and one
// full playCards turn. Exits 0 only if every assertion holds.
//
//   npm run build && node tools/smoke-beta-core.mjs
import { spawn } from 'node:child_process';
import { io as connect } from 'socket.io-client';

const ROOT = process.cwd();
const CODE_ALPHABET = '34679ACDEFHKMNPRTWXY';
const checks = [];
const ok = (label, cond, detail = '') => {
  checks.push({ label, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// An ephemeral high port; never :3000, which is left free for the dev server.
const PORT = 20000 + Math.floor(Math.random() * 30000);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server/dist/server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));

const waitForListen = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start in 15s')), 15_000);
  server.stdout.on('data', (b) => {
    if (String(b).includes('listening')) { clearTimeout(timer); resolve(); }
  });
  server.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited early: ${c}`)); });
});

const client = () => connect(BASE, { transports: ['websocket'] });
const join = (s, code, name, pin) => new Promise((res) => s.emit('joinRoom', { code, name, pin }, res));
// Every join broadcasts to everyone already seated, so a plain `once` can catch a
// stale lobby frame that was still in flight. Wait for the state we actually mean.
const waitState = (s, pred = () => true, ms = 10_000) => new Promise((resolve, reject) => {
  const handler = (v) => {
    if (!pred(v)) return;
    clearTimeout(timer); s.off('roomState', handler); resolve(v);
  };
  const timer = setTimeout(() => {
    s.off('roomState', handler); reject(new Error('timed out waiting for a matching roomState'));
  }, ms);
  s.on('roomState', handler);
});

const sockets = [];
let failed = false;
try {
  await waitForListen();

  // --- room creation: rules and PIN over HTTP -------------------------------
  const rules = { stacking: true, forcePlay: false, drawToMatch: true, multiDiscard: true };
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules, pin: '1234' }),
  });
  const { code } = await res.json();
  ok('POST /api/rooms returns 200', res.status === 200, `status ${res.status}`);
  ok('room code is 5 characters', code.length === 5, `got "${code}"`);
  ok('room code uses the look-alike-free alphabet',
    [...code].every((c) => CODE_ALPHABET.includes(c)), `got "${code}"`);

  // --- the PIN gate: absent, then wrong, then right -------------------------
  const a = client(); sockets.push(a);
  const noPin = await join(a, code, 'Host', undefined);
  ok('join without a PIN is refused with pin_required',
    noPin.ok === false && noPin.error === 'pin_required', JSON.stringify(noPin));

  const badPin = await join(a, code, 'Host', '9999');
  ok('join with the wrong PIN is refused with wrong_pin',
    badPin.ok === false && badPin.error === 'wrong_pin', JSON.stringify(badPin));

  const seatedA = await join(a, code, 'Host', '1234');
  ok('join with the right PIN seats the host at seat 0',
    seatedA.ok === true && seatedA.seat === 0, JSON.stringify(seatedA));

  const b = client(); sockets.push(b);
  const lobbyB = waitState(b, (v) => v.phase === 'lobby' && v.seats.length === 2);
  const seatedB = await join(b, code, 'Guest', '1234');
  ok('a second player takes seat 1', seatedB.ok === true && seatedB.seat === 1, JSON.stringify(seatedB));

  // --- the lobby view carries the rules and the PIN flag --------------------
  const lobby = await lobbyB;
  ok('lobby view reports phase lobby', lobby.phase === 'lobby', lobby.phase);
  ok('the three requested rules arrive on the view',
    lobby.rules.stacking && lobby.rules.drawToMatch && lobby.rules.multiDiscard && !lobby.rules.forcePlay,
    JSON.stringify(lobby.rules));
  ok('hasPin is set for a PIN-protected room', lobby.hasPin === true);
  ok('a non-host never sees the PIN digits', lobby.pin === null, String(lobby.pin));

  // --- the deal -------------------------------------------------------------
  const isPlaying = (v) => v.phase === 'playing';
  const dealtA = waitState(a, isPlaying), dealtB = waitState(b, isPlaying);
  a.emit('startGame');
  const [viewA, viewB] = await Promise.all([dealtA, dealtB]);
  ok('both players reach phase playing', viewA.phase === 'playing' && viewB.phase === 'playing');
  ok('every hand holds 7 cards', viewA.hand.length === 7 && viewB.hand.length === 7,
    `${viewA.hand.length} / ${viewB.hand.length}`);
  ok('the round opens on a NUMBER card', /^\d$/.test(viewA.topCard.value), viewA.topCard.value);
  ok('nothing is owed at the opening',
    viewA.pendingDraw === 0 && viewA.pendingDrawKind === null && viewA.mustChooseColor === false);
  ok('seat 0 acts first', viewA.turnSeat === 0, String(viewA.turnSeat));
  ok('the host sees their own PIN digits', viewA.pin === '1234', String(viewA.pin));
  ok('hands stay hidden from the opponent',
    viewA.seats[1].cardCount === 7 && viewB.seats[0].cardCount === 7);

  // --- one full turn, through playCards ------------------------------------
  const isNum = (c) => /^\d$/.test(c.value);
  const playable = (c) => c.value === 'wild' || c.value === 'wild4'
    || c.color === viewA.currentColor || c.value === viewA.topCard.value;
  const lead = viewA.hand.find((c) => isNum(c) && playable(c)) ?? viewA.hand.find(playable);
  if (!lead) throw new Error('seat 0 was dealt no playable card');
  // multiDiscard is on, so bring the rest of the rank along when the hand has any.
  const mates = isNum(lead)
    ? viewA.hand.filter((c) => c.id !== lead.id && isNum(c) && c.value === lead.value) : [];
  const cardIds = [lead.id, ...mates.map((c) => c.id)];

  const played = (v) => v.topCard?.id === cardIds[cardIds.length - 1];
  const afterA = waitState(a, played), afterB = waitState(b, played);
  a.emit('playCards', { cardIds, chosenColor: lead.color ?? 'red' });
  const [postA, postB] = await Promise.all([afterA, afterB]);
  ok(`playCards accepted (${cardIds.length} card${cardIds.length > 1 ? 's — a stack' : ''})`,
    postA.hand.length === 7 - cardIds.length, `hand ${viewA.hand.length} -> ${postA.hand.length}`);
  ok('the discard now shows the last card played', postA.topCard.id === cardIds[cardIds.length - 1]);
  ok('the opponent view updated too', postB.seats[0].cardCount === 7 - cardIds.length,
    `opponent sees ${postB.seats[0].cardCount}`);
  ok('the turn moved off seat 0', postA.turnSeat !== 0, String(postA.turnSeat));
  ok('both views agree on the top card', postA.topCard.id === postB.topCard.id);
} catch (err) {
  failed = true;
  console.error(`\nERROR: ${err.message}`);
} finally {
  for (const s of sockets) s.disconnect();
  server.kill('SIGTERM');
}

const bad = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
process.exit(failed || bad.length ? 1 : 0);
