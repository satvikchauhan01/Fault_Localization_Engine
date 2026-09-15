/**
 * @file heartbeat-emitter.js
 *
 * Simulator Heartbeat Emitter
 *
 * Periodically emits heartbeat(energized=true) telemetry through the real
 * /telemetry endpoint for every healthy, powered, monitored fw>=1.3 device.
 *
 * PURPOSE:
 *   In a real deployment, fw>=1.3 devices send a heartbeat every ~15 minutes.
 *   The sweeper heartbeat-timeout scan (Section H Rule 4) reads
 *   device.last_seen and declares a device CONFIRMED_DARK after >32 minutes.
 *   Without this emitter, all seeded devices go dark ~32 minutes after
 *   seeding because the seed sets last_seen once and nothing refreshes it.
 *
 * SPEC JUSTIFICATION:
 *   Section J Step 3: fw<1.2 -> never sends, just stops heartbeating.
 *   By contrast, healthy fw>=1.3 devices actively heartbeat. This emitter
 *   simulates that behaviour faithfully.
 *
 * RULES:
 *   1. Only fw>=1.3 devices are emitted (fw<1.3 never heartbeat by design).
 *   2. Devices under an active (unrepaired) SimulatorFault are skipped.
 *   3. Does NOT write to PoleState or Device directly -- everything flows
 *      through /telemetry -> ingestion worker -> device.last_seen update.
 *   4. Background process only, NOT a UI toggle (Section J Step 5 scope cut).
 *
 * INTERVAL: 10 min (simulator-private constant, not a domain threshold).
 */

import { PrismaClient } from '@prisma/client';
import { isFwLegacy } from './noise.js';

const prisma = new PrismaClient();

/** Emit a healthy heartbeat every 10 minutes. */
const HEARTBEAT_EMIT_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * Returns pole IDs physically affected by a simulator fault.
 * Used to determine which devices are dark and must NOT receive heartbeats.
 * MUST NOT be called from the localization engine (Section J boundary).
 *
 * @param {'SPAN'|'DT'|'FEEDER'} faultType
 * @param {string} targetId
 * @param {import('@prisma/client').PrismaClient} [db]
 * @returns {Promise<string[]>}
 */
export async function getAffectedPoleIds(faultType, targetId, db) {
  const p = db || prisma;

  if (faultType === 'DT') {
    const poles = await p.pole.findMany({ where: { dt_id: targetId }, select: { id: true } });
    return poles.map((pole) => pole.id);
  }

  if (faultType === 'FEEDER') {
    const poles = await p.pole.findMany({ where: { feeder_id: targetId }, select: { id: true } });
    return poles.map((pole) => pole.id);
  }

  if (faultType === 'SPAN') {
    const targetPole = await p.pole.findUnique({ where: { id: targetId } });
    if (!targetPole) return [];

    const dtPoles = await p.pole.findMany({
      where: { dt_id: targetPole.dt_id },
      select: { id: true },
    });
    const dtPoleIds = dtPoles.map((pole) => pole.id);

    const simTopo = await p.simTrueTopology.findMany({
      where: { pole_id: { in: dtPoleIds } },
    });

    const childrenMap = new Map();
    for (const link of simTopo) {
      if (link.parent_pole_id) {
        if (!childrenMap.has(link.parent_pole_id)) childrenMap.set(link.parent_pole_id, []);
        childrenMap.get(link.parent_pole_id).push(link.pole_id);
      }
    }

    const visited = new Set();
    const queue = [targetId];
    while (queue.length > 0) {
      const curr = queue.shift();
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const child of childrenMap.get(curr) || []) queue.push(child);
    }

    return [...visited];
  }

  return [];
}

/**
 * Emits one round of healthy heartbeats for all powered fw>=1.3 devices.
 *
 * @param {string} telemetryBaseUrl  Backend base URL
 * @param {import('@prisma/client').PrismaClient} [db]  Optional client for testing
 * @returns {Promise<{ emitted: number, skippedFault: number, skippedLegacy: number }>}
 */
export async function emitHealthyHeartbeats(telemetryBaseUrl, db) {
  const p = db || prisma;

  const devices = await p.device.findMany({ where: { pole_id: { not: null } } });

  const activeFaults = await p.simulatorFault.findMany({ where: { repaired_at: null } });
  const darkPoleIds = new Set();
  for (const fault of activeFaults) {
    const ids = await getAffectedPoleIds(fault.type, fault.target, p);
    for (const id of ids) darkPoleIds.add(id);
  }

  const seqBase = Date.now() % 2_000_000_000;
  let emitted = 0;
  let skippedFault = 0;
  let skippedLegacy = 0;

  for (let i = 0; i < devices.length; i++) {
    const device = devices[i];

    // Rule 1: Skip fw<1.3 (never heartbeat by design).
    if (isFwLegacy(device.fw_version)) {
      skippedLegacy++;
      continue;
    }

    // Rule 2: Skip devices physically dark under an active fault.
    if (device.pole_id && darkPoleIds.has(device.pole_id)) {
      skippedFault++;
      continue;
    }

    // Rule 3: Emit via the real /telemetry endpoint (not a direct DB write).
    const now = new Date().toISOString();
    const payload = {
      device_id: device.id,
      pole_id: device.pole_id,
      event: 'heartbeat',
      energized: true,
      device_ts: now,
      seq: (seqBase + i) % 2_147_483_647,
      battery_mv: 3700,
      rssi: -72,
      fw: device.fw_version,
      server_received_at: now,
    };

    try {
      const resp = await fetch(telemetryBaseUrl + '/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        emitted++;
      } else {
        console.warn('[heartbeat-emitter] POST failed for ' + device.id + ': ' + resp.status);
      }
    } catch (err) {
      // Non-fatal: a single missed heartbeat does not immediately trigger the
      // 32-minute timeout. Log and continue.
      console.warn('[heartbeat-emitter] Network error for ' + device.id + ':', err.message);
    }
  }

  return { emitted, skippedFault, skippedLegacy };
}

/**
 * Starts the periodic heartbeat emitter.
 *
 * @param {string} telemetryBaseUrl  Base URL of the backend.
 * @param {{ startup?: boolean }} [options]
 * @returns {{ interval: object, startupTimer: object }|null}
 */
export function startHeartbeatEmitter(telemetryBaseUrl, options = {}) {
  if (!telemetryBaseUrl) {
    console.warn('[heartbeat-emitter] No telemetryBaseUrl provided -- emitter disabled.');
    return null;
  }

  const startupEnabled = options.startup !== false;
  console.log(
    '[heartbeat-emitter] Starting. Interval: ' +
    (HEARTBEAT_EMIT_INTERVAL_MS / 60_000) +
    ' min. Startup emit: ' +
    (startupEnabled ? 'enabled' : 'disabled') +
    '.'
  );

  const runOnce = () => {
    emitHealthyHeartbeats(telemetryBaseUrl)
      .then(({ emitted, skippedFault, skippedLegacy }) => {
        console.log(
          '[heartbeat-emitter] Emitted: ' + emitted +
          ' | Skipped (fault): ' + skippedFault +
          ' | Skipped (legacy fw): ' + skippedLegacy
        );
      })
      .catch((err) => console.error('[heartbeat-emitter] Error during emit:', err));
  };

  // Initial emit after short startup delay (HTTP server must be ready first).
  const startupTimer = startupEnabled ? setTimeout(runOnce, 15_000) : null;

  // Recurring emit.
  const interval = setInterval(runOnce, HEARTBEAT_EMIT_INTERVAL_MS);

  return { interval, startupTimer };
}
