/*
 * Unified app entry: one Node process serves the Next.js frontend AND the
 * Express API + Socket.IO backend on the same port/origin.
 *
 * Run with: npm start   (after `npm run build`)
 */
process.env.SKIP_SERVER_LISTEN = '1';

const path = require('path');
// Load the backend's .env regardless of which folder the process starts from.
require('./server/node_modules/dotenv').config({ path: path.join(__dirname, 'server/.env') });
const next = require('./client/node_modules/next');
const { app, httpServer, startServer } = require('./server/dist/index');

const PORT = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== 'production';
const clientApp = next({ dev, dir: path.join(__dirname, 'client') });
const handle = clientApp.getRequestHandler();

clientApp
  .prepare()
  .then(async () => {
    // Connect DB and boot the game engine, but don't open a second listener —
    // the shared httpServer below is the only one.
    await startServer(false);

    // API routes are already registered on `app` by server/src/index.ts.
    // Everything else goes to Next.js.
    app.use((req, res) => handle(req, res));

    httpServer.listen(PORT, () => {
      console.log(`Spotibet unified app listening on port ${PORT}`);
      console.log('Frontend, REST API and Socket.IO are served from this one process.');
    });
  })
  .catch((err) => {
    console.error('Failed to start unified app:', err);
    process.exit(1);
  });
