/**
 * @file index.js — Backend application entrypoint
 *
 * Fastify server exposing:
 *   GET  /health     — Liveness probe
 *   POST /telemetry  — Ingestion endpoint (Step 18)
 */

import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = buildApp();

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[backend] Fastify server listening on http://${HOST}:${PORT}`);
    console.log(`[backend] Health: http://${HOST}:${PORT}/health`);
    console.log(`[backend] Telemetry endpoint: http://${HOST}:${PORT}/telemetry`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
