import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const socket: GameSocket = io({ autoConnect: false, transports: ['websocket'] });
