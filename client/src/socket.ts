import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import { reportError } from './errors';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const socket: GameSocket = io({ autoConnect: false, transports: ['websocket'] });

// Transport failures used to be completely silent: no console line, no
// analytics event. Every issue is warned immediately; at most one report
// per minute goes to analytics (reportError also dedupes by message).
let lastWsReportAt = 0;
function wsIssue(kind: string, detail: unknown): void {
  console.warn(`[ws] ${kind}:`, detail);
  const now = Date.now();
  if (now - lastWsReportAt < 60_000) return;
  lastWsReportAt = now;
  reportError(kind, detail, 'warning');
}

socket.on('connect_error', (err) => wsIssue('ws_connect_error', err));
socket.on('disconnect', (reason) => {
  if (reason !== 'io client disconnect') wsIssue('ws_disconnect', reason);
});
socket.io.on('reconnect_attempt', (attempt) => {
  if (attempt === 1) console.warn('[ws] connection lost, reconnecting…');
});
socket.io.on('reconnect', (attempts) => {
  console.warn(`[ws] reconnected after ${attempts} attempt(s)`);
});
