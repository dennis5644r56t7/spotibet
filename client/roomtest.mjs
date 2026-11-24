import { io } from 'socket.io-client';
const rooms = ['default', 'room-2', 'room-3'];
const clients = rooms.map((room) => {
  const s = io('http://localhost:3001', { transports: ['websocket'] });
  const c = { s, room, states: [], ticks: 0, countdowns: 0 };
  s.on('aviator:state', (d) => c.states.push({ roomId: d.roomId, roundId: d.roundId, state: d.state, players: d.players, rooms: d.rooms?.length }));
  s.on('aviator:tick', () => c.ticks++);
  s.on('aviator:countdown', () => c.countdowns++);
  s.on('connect', () => s.emit('aviator:join_room', { roomId: room }));
  return c;
});
await new Promise((r) => setTimeout(r, 9000));
for (const c of clients) {
  console.log(c.room, 'states=', JSON.stringify(c.states.slice(0, 2)), 'ticks=', c.ticks, 'countdowns=', c.countdowns);
  c.s.close();
}
process.exit(0);
