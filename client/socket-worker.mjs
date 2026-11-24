import { io } from 'socket.io-client';

const N = Number(process.argv[2] || 500);
const LABEL = process.argv[3] || 'w';
let connected = 0, errors = 0, ticks = 0;
const errs = new Set();
const sockets = [];
for (let i = 0; i < N; i++) {
  const s = io('http://localhost:3001', { transports: ['websocket'], reconnection: false, timeout: 20000 });
  s.on('connect', () => connected++);
  s.on('aviator:tick', () => ticks++);
  s.on('connect_error', (e) => { errors++; if (errs.size < 3) errs.add(e?.message || String(e)); });
  sockets.push(s);
}
await new Promise((r) => setTimeout(r, 5000));
console.log(`${LABEL} connected=${connected} errors=${errors} ticks=${ticks} errs=${[...errs].join('|')}`);
for (const s of sockets) s.close();
await new Promise((r) => setTimeout(r, 800));
process.exit(0);
