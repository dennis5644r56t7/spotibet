// MUST be the first import: every service reads process.env lazily, but
// dotenv still has to run before the rest of the application modules.
import 'dotenv/config';

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors, { CorsOptions } from 'cors';
import jwt from 'jsonwebtoken';
import { connectDB } from './config/db';
import apiRoutes from './routes/api.routes';
import { AviatorRoomManager } from './games/aviator/aviator.room-manager';

const app = express();
const server = http.createServer(app);
export { app, server as httpServer };

app.disable('x-powered-by');

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const allowedOrigins = (process.env.CORS_ORIGINS || FRONTEND_URL)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Same-origin/server-to-server requests have no Origin header.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (!IS_PRODUCTION && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature'],
};

// Middleware
app.use(cors(corsOptions));
app.use(
  express.json({
    limit: '1mb',
    // Paystack signs the exact raw bytes of the webhook body. Keeping a copy
    // here lets the controller verify it without re-serialising parsed JSON.
    verify: (req, _res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    },
  })
);

// Graceful Chrome DevTools / .well-known handler
app.use((req, res, next) => {
  if (req.path.startsWith('/.well-known')) {
    return res.status(204).end();
  }
  next();
});

// Root Route - Directs visitor to Frontend UI (standalone backend only; in
// unified mode this would shadow Next.js's own home page).
if (process.env.SKIP_SERVER_LISTEN !== '1') {
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Spotibet Casino & Game Engine</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #080204; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .box { padding: 40px; border: 1px solid #3b0d17; border-radius: 24px; background: #14050b; max-width: 480px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
            h1 { color: #dc1c34; margin: 0 0 10px 0; font-size: 26px; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 10px 0; }
            .btn { color: #fff; text-decoration: none; font-weight: bold; background: #dc1c34; padding: 14px 28px; border-radius: 14px; display: inline-block; margin-top: 20px; font-size: 15px; box-shadow: 0 4px 20px rgba(220,28,52,0.4); transition: transform 0.15s; }
            .btn:hover { background: #f02840; transform: scale(1.02); }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 8px; background: rgba(220,28,52,0.15); color: #ff4760; font-size: 11px; font-weight: bold; border: 1px solid rgba(220,28,52,0.3); margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="badge">● SPOTIBET ENGINE ONLINE & READY</div>
            <h1>🎰 Spotibet Game Engine</h1>
            <p>You have accessed the backend API & real-time WebSocket server on <strong>Port 5000</strong>.</p>
            <p>To play <strong>Aviator</strong>, <strong>Roulette</strong>, <strong>Blackjack</strong>, <strong>Slots</strong>, and <strong>Mines</strong> with the full interactive UI, open the Spotibet frontend:</p>
            <a class="btn" href="${FRONTEND_URL}">🚀 Open Spotibet Casino</a>
          </div>
        </body>
      </html>
    `);
  }
  res.json({
    service: 'SPOTIBET CASINO & AVIATOR PLATFORM',
    status: 'online',
    frontendUrl: FRONTEND_URL,
    message: `Visit ${FRONTEND_URL} to launch the Spotibet Casino UI`,
  });
});
}

// Routes
app.use('/api', apiRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date(),
    service: 'Betting & Aviator Game Engine',
    payments: {
      provider: 'paystack',
      currency: (process.env.DEFAULT_CURRENCY || 'KES').toUpperCase(),
      configured: Boolean(
        process.env.PAYSTACK_SECRET_KEY &&
          !process.env.PAYSTACK_SECRET_KEY.toLowerCase().includes('placeholder')
      ),
    },
  });
});

// Socket.io for Real-time Multiplayer Aviator
export const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Initialize Aviator continuous flight engine
const aviatorRooms = new AviatorRoomManager(io, 1000);

// Socket.io authentication & event routing
io.on('connection', (socket) => {
  let user: any = null;

  // Extract auth token from handshake query or headers
  const token = (socket.handshake.query?.token as string) || (socket.handshake.auth?.token as string);

  if (token) {
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      socket.data.user = user;
    } catch (err) {
      // Unauthenticated / spectator mode
    }
  }

  // Send current game state immediately to newly connected client
  socket.emit('aviator:state', aviatorRooms.getState('default'));

  // Join a parallel room (1000 players each). The engine for that room owns
  // the round and all broadcasts are scoped to it.
  socket.on('aviator:join_room', (data: { roomId?: string }, callback) => {
    const joined = aviatorRooms.join(socket, data?.roomId);
    const state = aviatorRooms.getState(joined.roomId);
    socket.emit('aviator:state', state);
    callback?.({ ...joined, success: true });
    io.to(joined.roomId).emit('aviator:rooms', { rooms: aviatorRooms.listRooms() });
  });

  socket.on('aviator:rooms', (callback) => {
    callback?.({ rooms: aviatorRooms.listRooms() });
  });

  // Re-send on demand: game components mount after the socket is already
  // connected (e.g. navigating from the lobby), so they miss the initial push
  // and would otherwise show an empty multiplier history until the next crash.
  socket.on('aviator:get_state', (data: { roomId?: string } | undefined, callback?: any) => {
    const cb = typeof data === 'function' ? data : callback;
    const roomId = (typeof data === 'object' && data?.roomId) || socket.data.aviatorRoom || 'default';
    socket.emit('aviator:state', aviatorRooms.getState(roomId));
    cb?.({ ok: true });
  });

  // Handle Aviator Bet
  socket.on('aviator:bet', async (data: { amount: number; balanceType: 'REAL' | 'DEMO'; autoCashout?: number }, callback) => {
    try {
      if (!socket.data.user && !user) {
        return callback?.({ error: 'Authentication required to place bets' });
      }

      const activeUser = socket.data.user || user;
      const res = await aviatorRooms.placeBet(socket.data.aviatorRoom, {
        userId: activeUser.id,
        username: activeUser.username,
        amount: data.amount,
        balanceType: data.balanceType || 'DEMO',
        autoCashout: data.autoCashout,
      });

      callback?.({ success: true, bet: res.bet, newBalance: res.newBalance });
    } catch (error: any) {
      callback?.({ error: error.message || 'Failed to place bet' });
    }
  });

  // Handle Aviator Bet Cancellation (during countdown)
  socket.on('aviator:cancel', async (data: { betId: string }, callback) => {
    try {
      if (!socket.data.user && !user) {
        return callback?.({ error: 'Authentication required to cancel bet' });
      }

      const activeUser = socket.data.user || user;
      const res = await aviatorRooms.cancelBet(socket.data.aviatorRoom, activeUser.id, data.betId);

      callback?.({ success: true, newBalance: res.newBalance });
    } catch (error: any) {
      callback?.({ error: error.message || 'Failed to cancel bet' });
    }
  });

  // Handle Aviator Cashout
  socket.on('aviator:cashout', async (data: { betId: string }, callback) => {
    try {
      if (!socket.data.user && !user) {
        return callback?.({ error: 'Authentication required to cash out' });
      }

      const activeUser = socket.data.user || user;
      const res = await aviatorRooms.cashoutBet(socket.data.aviatorRoom, activeUser.id, data.betId);

      callback?.({
        success: true,
        payout: res.payout,
        multiplier: res.multiplier,
        newBalance: res.newBalance,
      });
    } catch (error: any) {
      callback?.({ error: error.message || 'Failed to cash out' });
    }
  });

  socket.on('disconnect', () => {
    // Clean up if needed
  });
});

function validateProductionConfig() {
  const problems: string[] = [];
  const jwtSecret = process.env.JWT_SECRET || '';
  const paystackKey = process.env.PAYSTACK_SECRET_KEY || '';

  if (!jwtSecret || jwtSecret === 'secret' || jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  if (!paystackKey || paystackKey.toLowerCase().includes('placeholder')) {
    problems.push('PAYSTACK_SECRET_KEY must be set to a live or test secret key');
  }
  if (!process.env.FRONTEND_URL) {
    problems.push('FRONTEND_URL must be set so Paystack can redirect players back');
  }

  if (problems.length === 0) return;

  if (IS_PRODUCTION) {
    console.error('❌ Refusing to start in production with insecure configuration:');
    for (const problem of problems) console.error(`   - ${problem}`);
    process.exit(1);
  }

  console.warn('⚠️  Development configuration warnings:');
  for (const problem of problems) console.warn(`   - ${problem}`);
}

// Connect to Database and start Server
export async function startServer(listen = true) {
  validateProductionConfig();
  await connectDB();
  if (!listen) return;
  server.listen(PORT, () => {
    console.log(`🎰 Casino & Aviator Game Engine listening on port ${PORT}`);
    console.log(`📡 WebSocket ready for live multiplayer connections`);
    console.log(
      `💳 Paystack: ${
        process.env.PAYSTACK_SECRET_KEY &&
        !process.env.PAYSTACK_SECRET_KEY.toLowerCase().includes('placeholder')
          ? 'configured'
          : 'NOT configured (cashier will reject live deposits/withdrawals)'
      }`
    );
  });
}

// When the unified app imports this module it starts the listener itself so
// Next.js can share the same HTTP server (and therefore the same port/origin).
if (process.env.SKIP_SERVER_LISTEN !== '1') {
  startServer();
}
