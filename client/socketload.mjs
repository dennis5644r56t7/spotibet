import { io } from 'socket.io-client';

const stages = [100, 500, 1000, 3000, 5000, 10000];

async function run(n) {
  let connected = 0, ticks = 0, errors = 0;
  const sockets = [];
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const s = io('http://localhost:3001', {
      transports: ['websocket'],
      reconnection: false,
      timeout: 15000,
    });
    s.on('connect', () => connected++);
    s.on('aviator:tick', () => ticks++);
    s.on('connect_error', () => errors++);
    sockets.push(s);
  }
  // hold connections for one full round window
  await new Promise((r) => setTimeout(r, 6000));
  const elapsed = (performance.now() - start) / 1000;
  console.log(
    `N=${String(n).padStart(5)} connected=${connected} errors=${errors} ticks=${ticks} ` +
    `connectRate=${(connected/n*100).toFixed(1)}% elapsed=${elapsed.toFixed(1)}s`
  );
  for (const s of sockets) s.close();
  await new Promise((r) => setTimeout(r, 1500));
}

for (const n of stages) await run(n);
