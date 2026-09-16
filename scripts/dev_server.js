// Lightweight local development server: serves the static frontend
// (index.html, admin.html, public/**) and every api/*.js route on a
// single port, without requiring Vercel CLI login/project linking.
//
// This intentionally mirrors Vercel's file-based routing convention by
// hand (a small fixed route map, not a directory-scanning router) - the
// route set is small and fixed, so a scanner would be more machinery for
// no real benefit. If new api/*.js files are added, add them here too.
//
// The WebSocket endpoint (/api/ws) is handled by delegating the HTTP
// 'upgrade' event to api/ws.js's own exported http.Server instance. That
// module attaches a `ws` WebSocketServer to whatever server object it's
// given via `new WebSocketServer({ server })`, which internally just
// subscribes to that object's 'upgrade' event - it doesn't require the
// object to actually be network-listening. So instead of running a
// second server/port (which would break same-origin WebSocket connects
// from the browser), this server re-emits its own 'upgrade' events onto
// api/ws.js's server object, letting its already-wired handshake/message
// logic run unmodified.
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPTS_DIR, '..');
const PORT = process.env.PORT || 3000;

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`${key} is not set. See .env.example and docs/database/setup.md.`);
    process.exit(1);
  }
}

const wsServer = (await import(path.join(REPO_ROOT, 'api/ws.js'))).default;

const routes = {
  'POST /api/auth/login': (await import(path.join(REPO_ROOT, 'api/auth/login.js'))).default,
  'GET /api/auth/me': (await import(path.join(REPO_ROOT, 'api/auth/me.js'))).default,
  'POST /api/auth/change-password': (await import(path.join(REPO_ROOT, 'api/auth/change-password.js'))).default,
  'GET /api/devices': (await import(path.join(REPO_ROOT, 'api/devices/index.js'))).default,
  'POST /api/devices': (await import(path.join(REPO_ROOT, 'api/devices/index.js'))).default,
  'GET /api/readings': (await import(path.join(REPO_ROOT, 'api/readings.js'))).default,
  'POST /api/readings': (await import(path.join(REPO_ROOT, 'api/readings.js'))).default,
  'POST /api/predict': (await import(path.join(REPO_ROOT, 'api/predict.js'))).default,
  'GET /api/predictions': (await import(path.join(REPO_ROOT, 'api/predictions.js'))).default,
  'GET /api/alerts': (await import(path.join(REPO_ROOT, 'api/alerts.js'))).default,
  'PATCH /api/alerts': (await import(path.join(REPO_ROOT, 'api/alerts.js'))).default,
  'GET /api/system/health': (await import(path.join(REPO_ROOT, 'api/system/health.js'))).default,
};
const deviceDetailHandler = (await import(path.join(REPO_ROOT, 'api/devices/[deviceId].js'))).default;

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const PUBLIC_ROOT = path.join(REPO_ROOT, 'public');

async function serveStatic(req, res, pathname) {
  // Mirrors Vercel's static-file convention: everything under public/ is
  // served from the web root (the `public` segment itself is not part of
  // the URL) - see docs/deployment/vercel.md.
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(PUBLIC_ROOT, filePath);
  if (!fullPath.startsWith(PUBLIC_ROOT) || !existsSync(fullPath)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const ext = path.extname(fullPath);
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.end(await readFile(fullPath));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(req, res, url.pathname);
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  req.body = chunks.length ? Buffer.concat(chunks).toString('utf-8') : undefined;
  req.query = Object.fromEntries(url.searchParams.entries());

  const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (deviceMatch) {
    req.query.deviceId = deviceMatch[1];
    return deviceDetailHandler(req, res);
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }));
  }
  return handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, `http://localhost:${PORT}`).pathname === '/api/ws') {
    wsServer.emit('upgrade', req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Water Quality Monitor dev server running at http://localhost:${PORT}`);
  console.log(`  Public readout: http://localhost:${PORT}/index.html`);
  console.log(`  Admin console:  http://localhost:${PORT}/admin.html`);
});
