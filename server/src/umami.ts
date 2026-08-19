import type { FastifyBaseLogger } from 'fastify';

export interface Visitor { ip?: string; userAgent?: string }

export type UmamiSender = (
  name: string,
  data?: Record<string, unknown>,
  visitor?: Visitor,
) => Promise<void>;

export interface UmamiSenderOptions {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  log?: FastifyBaseLogger;
  now?: () => number;
  timeoutMs?: number;
}

// Umami refuses requests without a User-Agent; this one marks server-truth
// events whenever the player's own UA is unknown (pre-join sockets).
const SERVER_UA = 'Mozilla/5.0 (compatible; ochre-eights-server)';
const WARN_EVERY_MS = 60_000;

/** Server-side Umami sender (v2.17+): POST /api/send with ip/userAgent
 *  overrides in the payload, so a socket's server-truth events land in the
 *  same Umami session as the player's own pageviews. Fire-and-forget by
 *  contract — never throws, never blocks a game path — and a no-op until
 *  both a website id and a host are configured in env. */
export function createUmamiSender(opts: UmamiSenderOptions = {}): UmamiSender {
  const env = opts.env ?? process.env;
  const websiteId = env.UMAMI_WEBSITE_ID;
  const host = env.UMAMI_HOST || originOf(env.UMAMI_SRC);
  if (!websiteId || !host) return async () => {};

  const log = opts.log;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const endpoint = `${host.replace(/\/+$/, '')}/api/send`;

  // A dead Umami must not turn the log into a firehose: one warn a minute.
  let warnMutedUntil = -Infinity;
  const warn = (details: Record<string, unknown>): void => {
    if (now() < warnMutedUntil) return;
    warnMutedUntil = now() + WARN_EVERY_MS;
    log?.warn({ evt: 'umami_send_failed', ...details }, 'umami send failed');
  };

  return async (name, data, visitor) => {
    try {
      const fetchFn = opts.fetchFn ?? fetch;
      const payload: Record<string, unknown> = { website: websiteId, url: '/srv', name };
      if (data !== undefined) payload.data = data;
      if (visitor?.ip) payload.ip = visitor.ip;
      if (visitor?.userAgent) payload.userAgent = visitor.userAgent;
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': visitor?.userAgent ?? SERVER_UA,
        },
        body: JSON.stringify({ type: 'event', payload }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) warn({ name, status: res.status });
    } catch (err) {
      warn({ name, err: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** UMAMI_HOST wins; otherwise the tracker script's origin serves the same
 *  /api/send endpoint (UMAMI_SRC looks like https://<UMAMI_HOST>/script.js). */
function originOf(src: string | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}
