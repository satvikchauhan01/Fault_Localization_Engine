/**
 * @file run.js — Entrypoint for the long-running Ingestion Worker process
 */

import { processNextTelemetryEvent } from './ingestion-worker.js';
import { sweepTimeouts } from './sweeper.js';
import { startHeartbeatEmitter } from '../simulator/heartbeat-emitter.js';

import { fileURLToPath } from 'url';
import { runRestorationVerifier } from '../tickets/restoration-verifier.js';

const POLL_INTERVAL_MS = 10;
const IDLE_POLL_INTERVAL_MS = 1000;
const SWEEP_INTERVAL_MS = 5000;
const VERIFIER_INTERVAL_MS = 15000;

let isShuttingDown = false;
let loopTimeoutId = null;
let sweeperIntervalId = null;
let verifierIntervalId = null;
let heartbeatTimers = null;

console.log('[Worker] Worker module loaded.');

async function loop() {
  if (isShuttingDown) {
    console.log('[Worker] Shutting down loop.');
    return;
  }

  try {
    const processed = await processNextTelemetryEvent();
    loopTimeoutId = setTimeout(loop, processed ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
  } catch (err) {
    console.error('[Worker] Fatal error in processing loop:', err);
    loopTimeoutId = setTimeout(loop, IDLE_POLL_INTERVAL_MS);
  }
}

export function startWorker() {
  if (!isShuttingDown && (sweeperIntervalId || verifierIntervalId || loopTimeoutId)) {
    console.log('[Worker] Worker already started.');
    return;
  }
  if (isShuttingDown) isShuttingDown = false;
  console.log('[Worker] Starting background ingestion worker process...');

  const telemetryBaseUrl = process.env.TELEMETRY_BASE_URL || 'http://localhost:3000';
  heartbeatTimers = startHeartbeatEmitter(telemetryBaseUrl, {
    startup: process.env.HEARTBEAT_EMITTER_STARTUP !== '0',
  });

  sweeperIntervalId = setInterval(() => {
    if (!isShuttingDown) {
      sweepTimeouts().catch(err => console.error('[Worker] Sweeper error:', err));
    }
  }, SWEEP_INTERVAL_MS);

  verifierIntervalId = setInterval(() => {
    if (!isShuttingDown) {
      runRestorationVerifier().catch(err => console.error('[Worker] Verifier error:', err));
    }
  }, VERIFIER_INTERVAL_MS);

  loop();
}

export function stopWorker() {
  console.log('[Worker] Shutting down gracefully...');
  isShuttingDown = true;
  
  if (loopTimeoutId) {
    clearTimeout(loopTimeoutId);
    loopTimeoutId = null;
  }
  if (sweeperIntervalId) {
    clearInterval(sweeperIntervalId);
    sweeperIntervalId = null;
  }
  if (verifierIntervalId) {
    clearInterval(verifierIntervalId);
    verifierIntervalId = null;
  }
  
  if (heartbeatTimers) {
    if (heartbeatTimers.interval) clearInterval(heartbeatTimers.interval);
    if (heartbeatTimers.startupTimer) clearTimeout(heartbeatTimers.startupTimer);
    heartbeatTimers = null;
  }
}

// Automatically start if run as the main entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWorker();
  
  process.on('SIGINT', () => {
    console.log('[Worker] Received SIGINT.');
    stopWorker();
  });
  
  process.on('SIGTERM', () => {
    console.log('[Worker] Received SIGTERM.');
    stopWorker();
  });
}
