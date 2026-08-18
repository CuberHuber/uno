// HTTP benchmark: raw latency/throughput for the health endpoint and the SPA
// shell against a running server.
//   npm run bench:http        (env: BASE_URL, DURATION seconds, CONNECTIONS)
import autocannon from 'autocannon';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const duration = Number(process.env.DURATION ?? 10);
const connections = Number(process.env.CONNECTIONS ?? 25);

console.log(`autocannon → ${base} (${connections} connections, ${duration}s per route)`);
for (const route of ['/healthz', '/']) {
  const res = await autocannon({ url: base + route, connections, duration });
  console.log(
    [
      route.padEnd(10),
      `${Math.round(res.requests.average)} req/s`,
      `p50 ${res.latency.p50} ms`,
      `p97.5 ${res.latency.p97_5} ms`,
      `p99 ${res.latency.p99} ms`,
      res.non2xx ? `non-2xx ${res.non2xx}` : '',
      res.errors ? `errors ${res.errors}` : '',
    ].filter(Boolean).join('  '),
  );
}
