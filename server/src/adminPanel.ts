/** Self-contained admin dashboard served at /admin. Deliberately dependency-free:
 *  a token gate (stored in localStorage), stat tiles, and a 10 s refresh loop
 *  against /api/admin/stats. Dark-only by design — it is an internal tool. */
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ochre Eights — table service</title>
<style>
  body { margin:0; padding:32px 20px; background:#211c15; color:#ede5d6;
         font:15px/1.5 system-ui, sans-serif; }
  main { max-width:880px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#a2977f; margin:0 0 24px; font-size:13px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:12px; }
  .tile { background:#2a241b; border:1px solid #3a3325; border-radius:6px; padding:14px 16px; }
  .tile .k { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#a2977f; }
  .tile .v { font-size:26px; font-variant-numeric:tabular-nums; margin-top:4px; color:#ede5d6; }
  .tile .v small { font-size:13px; color:#a2977f; font-weight:400; }
  form { display:flex; gap:8px; margin:16px 0; }
  input { flex:1; padding:10px 12px; border-radius:6px; border:1px solid #3a3325;
          background:#2a241b; color:#ede5d6; font:inherit; }
  button { padding:10px 16px; border-radius:6px; border:none; background:#d9a84e;
           color:#211c15; font:600 14px system-ui, sans-serif; cursor:pointer; }
  button:focus-visible, input:focus-visible { outline:2px solid #d9a84e; outline-offset:2px; }
  #err { color:#de8a5b; min-height:1.4em; }
  code { background:#2a241b; padding:1px 5px; border-radius:3px; }
</style>
</head>
<body>
<main>
  <h1>Ochre Eights — table service</h1>
  <p class="sub">Aggregates since server start · refreshes every 10 s · <span id="stamp"></span></p>
  <div id="gate" hidden>
    <p>Paste the admin token (the server's <code>ADMIN_TOKEN</code>):</p>
    <form id="f">
      <input id="t" type="password" placeholder="admin token" autocomplete="off">
      <button type="submit">Save</button>
    </form>
  </div>
  <p id="err"></p>
  <div id="grid" class="grid"></div>
</main>
<script>
(function () {
  var KEY = 'oe:admintoken';
  var f = document.getElementById('f'), gate = document.getElementById('gate');
  var grid = document.getElementById('grid'), err = document.getElementById('err');
  var stamp = document.getElementById('stamp');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    localStorage.setItem(KEY, document.getElementById('t').value.trim());
    load();
  });
  function tile(k, v, hint) {
    return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v +
      (hint ? ' <small>' + hint + '</small>' : '') + '</div></div>';
  }
  // Every value rendered into the grid passes through fmt: only finite
  // numbers survive, so no string from the wire can reach innerHTML.
  function fmt(n) { return typeof n === 'number' && isFinite(n) ? n : '—'; }
  function load() {
    var token = localStorage.getItem(KEY) || '';
    fetch('/api/admin/stats', { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 404) throw new Error('Admin stats are disabled: set ADMIN_TOKEN on the server.');
        if (r.status === 401) { gate.hidden = false; throw new Error(token ? 'That token was rejected.' : ''); }
        return r.json();
      })
      .then(function (s) {
        gate.hidden = true; err.textContent = '';
        stamp.textContent = 'up ' + Math.floor(s.uptimeS / 3600) + ' h ' + Math.floor(s.uptimeS % 3600 / 60) + ' m';
        grid.innerHTML =
          tile('Players online', fmt(s.players.connectedNow)) +
          tile('Unique today', fmt(s.players.uniqueToday), 'UTC day') +
          tile('Unique yesterday', fmt(s.players.uniqueYesterday), 'UTC day') +
          tile('Visits', fmt(s.visits), 'since boot') +
          tile('Sessions', fmt(s.sessions.count),
               s.sessions.avgMinutes === null ? '' : 'avg ' + fmt(s.sessions.avgMinutes) + ' min') +
          tile('Rooms open', fmt(s.now ? s.now.rooms : null),
               s.now ? fmt(s.now.playing) + ' playing' : '') +
          tile('Rooms created', fmt(s.rooms.created), 'since boot') +
          tile('Seats taken', fmt(s.rooms.playersJoined), 'since boot') +
          tile('Rounds dealt', fmt(s.rounds.started)) +
          tile('Rounds won', fmt(s.rounds.finished),
               s.rounds.avgMinutes === null ? '' : 'avg ' + fmt(s.rounds.avgMinutes) + ' min') +
          tile('Avg table size', fmt(s.rounds.avgSeats));
      })
      .catch(function (e) { err.textContent = e.message || String(e); });
  }
  load();
  setInterval(load, 10000);
})();
</script>
</body>
</html>`;
