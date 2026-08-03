/**
 * @file index.js — Backend application entrypoint (placeholder until Step 18)
 *
 * Exposes a minimal HTTP server with:
 *   GET /health  — liveness probe used by Docker Compose healthcheck
 *
 * This will be replaced by the full Fastify server in Step 18.
 */

import { createServer } from 'http';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'kspdb-backend' }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[backend] Server listening on http://${HOST}:${PORT}`);
  console.log(`[backend] Health: http://${HOST}:${PORT}/health`);
});
