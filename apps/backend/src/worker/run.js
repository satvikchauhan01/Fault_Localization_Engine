/**
 * @file run.js — Entrypoint for the long-running Ingestion Worker process
 */

import { processNextTelemetryEvent } from './ingestion-worker.js';
import { sweepTimeouts } from './sweeper.js';
import { startHeartbeatEmitter } from '../simulator/heartbeat-emitter.js';

const POLL_INTERVAL_MS = 1000;
const IDLE_POLL_INTERVAL_MS = 5000;
const SWEEP_INTERVAL_MS = 10000;

let isShuttingDown = false;

console.log('[Worker] Starting background ingestion worker process...');

// Start simulator heartbeat emitter. This keeps seeded fw>=1.3 devices from
// false-timing-out while the demo is running (Section H Rule 4 / Section J Step 3).
// It is intentionally wired here (same process as the worker) to avoid adding
// a new Docker service. TELEMETRY_BASE_URL can be overridden in tests.
const telemetryBaseUrl = process.env.TELEMETRY_BASE_URL || 'http://localhost:3000';
startHeartbeatEmitter(telemetryBaseUrl);

async function loop() {
  if (isShuttingDown) {
    console.log('[Worker] Shutting down loop.');
    return;
  }

  try {
    const processed = await processNextTelemetryEvent();
    
    // If we processed something, check again quickly (throttle slightly to not spin).
    // If queue is empty, sleep longer to reduce DB load.
    setTimeout(loop, processed ? 100 : IDLE_POLL_INTERVAL_MS);
  } catch (err) {
    console.error('[Worker] Fatal error in processing loop:', err);
    // Sleep a bit before retrying on error to avoid tight error loops
    setTimeout(loop, IDLE_POLL_INTERVAL_MS);
  }
}

// Start sweeping loop
setInterval(() => {
  if (!isShuttingDown) {
    sweepTimeouts().catch(err => console.error('[Worker] Sweeper error:', err));
  }
}, SWEEP_INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
});
process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM. Shutting down gracefully...');
  isShuttingDown = true;
});

// Start loop
loop();
