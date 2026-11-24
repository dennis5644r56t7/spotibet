import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

let socket: Socket | null = null;
let lastToken: string | null = null;

export function getSocket(token?: string): Socket {
  const resolvedToken = token && token.trim() !== ''
    ? token
    : (typeof window !== 'undefined' ? localStorage.getItem('casino_token') || '' : '');

  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: { token: resolvedToken },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('⚡ Connected to Aviator Game Engine Socket:', socket?.id);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Disconnected from Aviator Socket');
    });

    lastToken = resolvedToken;
  } else if (resolvedToken && resolvedToken !== lastToken) {
    // Token changed → reconnect so the server sees the authenticated user
    lastToken = resolvedToken;
    socket.auth = { token: resolvedToken };
    socket.disconnect();
    socket.connect();
  }

  return socket;
}
