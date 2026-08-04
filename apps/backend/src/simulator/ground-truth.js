/**
 * @file ground-truth.js
 *
 * Simulator ground-truth module.
 *
 * DESIGN BOUNDARY:
 *   This module reads the PHYSICAL topology (Pole.parent_pole_id, Pole.device_id,
 *   Pole.dt_id, Pole.feeder_id) to determine which poles lose power under a
 *   simulated fault.
 *
 *   It MUST NOT read:
 *     - PoleState     (that is the engine's derived belief)
 *     - TopologyEdge  (that is the engine's derived topology)
 *     - Incident      (that is the engine's derived fault output)
 *
 *   It writes ONLY to:
 *     - SimulatorFault (audit log of injected faults)
 *     - The /telemetry HTTP endpoint (to drive the real ingestion pipeline)
 *
 *   Unmonitored poles (device_id == null) receive no telemetry — correctly
 *   simulating real-world behavior where ~9% of poles have no IoT sensor.
 */

import { prisma as defaultPrisma } from '../db.js';
import { randomUUID } from 'crypto';
import { applyNoiseToPayloads, isFwLegacy, isDyingMessageLost } from './noise.js';

/**
 * Returns the set of poles whose physical power is interrupted by the given fault.
 *
 * For SPAN faults: the target pole and every physical descendant (BFS down
 *   the Pole.parent_pole_id tree — NOT TopologyEdge).
 * For DT faults:   all poles with pole.dt_id === targetId.
 * For FEEDER faults: all poles with pole.feeder_id === targetId.
 *
 * @param {'SPAN'|'DT'|'FEEDER'} faultType
 * @param {string} targetId  Pole ID (SPAN), DT ID (DT), or Feeder ID (FEEDER)
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 * @returns {Promise<import('@prisma/client').Pole[]>} Affected poles (including unmonitored)
 */
export async function getPolesForFault(faultType, targetId, prismaClient) {
  const db = prismaClient || defaultPrisma;

  if (faultType === 'DT') {
    return await db.pole.findMany({ where: { dt_id: targetId } });
  }

  if (faultType === 'FEEDER') {
    return await db.pole.findMany({ where: { feeder_id: targetId } });
  }

  if (faultType === 'SPAN') {
    // BFS downward using Pole.parent_pole_id (ground-truth physical adjacency)
    // We need to find all poles whose ancestor chain leads through targetId.
    // Strategy: load all poles in the same DT, then BFS from targetId.
    const targetPole = await db.pole.findUnique({ where: { id: targetId } });
    if (!targetPole) {
      throw new Error(`SPAN fault target pole ${targetId} not found.`);
    }

    // Load all poles in the same DT to enable BFS using parent_pole_id
    const dtPoles = await db.pole.findMany({ where: { dt_id: targetPole.dt_id } });

    // Build children map from simulator's ground-truth true topology table,
    // NOT the department-visible Pole table, because Pole.parent_pole_id is
    // null for MISSING-topology DTs.
    const dtPoleIds = dtPoles.map(p => p.id);
    const simTopo = await db.simTrueTopology.findMany({
      where: { pole_id: { in: dtPoleIds } }
    });

    const childrenMap = new Map();
    for (const link of simTopo) {
      if (link.parent_pole_id) {
        if (!childrenMap.has(link.parent_pole_id)) childrenMap.set(link.parent_pole_id, []);
        childrenMap.get(link.parent_pole_id).push(link.pole_id);
      }
    }

    const poleById = new Map(dtPoles.map(p => [p.id, p]));

    // BFS from target pole downward
    const affected = [];
    const queue = [targetId];
    const visited = new Set();

    while (queue.length > 0) {
      const curr = queue.shift();
      if (visited.has(curr)) continue;
      visited.add(curr);

      const pole = poleById.get(curr);
      if (pole) affected.push(pole);

      for (const child of childrenMap.get(curr) || []) {
        queue.push(child);
      }
    }

    return affected;
  }

  throw new Error(`Unknown fault type: ${faultType}. Must be SPAN, DT, or FEEDER.`);
}

/**
 * Builds a valid TelemetryIngestSchema-compatible payload for a pole/device pair.
 *
 * @param {import('@prisma/client').Pole} pole
 * @param {import('@prisma/client').Device} device
 * @param {'power_lost'|'power_restored'} event
 * @param {number} [seq] Sequence number (defaults to Date.now())
 * @returns {object} Telemetry payload
 */
export function buildTelemetryPayload(pole, device, event, seq) {
  const now = new Date().toISOString();
  // Postgres `Int` is 32-bit signed. Cap seq to safe range.
  const safeSeq = seq !== undefined ? (seq % 2_147_483_647) : (Date.now() % 2_147_483_647);
  return {
    device_id: device.id,
    pole_id: pole.id,
    event,
    energized: event === 'power_restored',
    device_ts: now,
    seq: safeSeq,
    battery_mv: 3700,
    rssi: -72,
    fw: device.fw_version,
    server_received_at: now,
  };
}

/**
 * Injects a simulated fault by:
 *   1. Computing affected poles from ground-truth physical topology.
 *   2. Sending `power_lost` telemetry for each monitored pole (has a device),
 *      skipping devices with firmware < 1.3 (fw-1.2.x silence).
 *   3. Applying noise transformations (duplicate resends, out-of-order delivery) if requested.
 *   4. Recording the fault in SimulatorFault.
 *
 * @param {'SPAN'|'DT'|'FEEDER'} faultType
 * @param {string} targetId
 * @param {string} telemetryBaseUrl  Base URL of the backend (e.g. "http://localhost:3000")
 * @param {import('@prisma/client').PrismaClient|object} [prismaClient] Prisma client instance or options
 * @param {object} [options] Noise injection options ({ duplicates, reorder })
 * @returns {Promise<{ faultId: string; affectedPoles: string[]; telemetrySent: number }>}
 */
export async function injectFault(faultType, targetId, telemetryBaseUrl, prismaClient, options = {}) {
  let db = prismaClient;
  let opts = options;

  // Handle flexible signature where prismaClient is omitted or passed as options
  if (prismaClient && typeof prismaClient === 'object' && !prismaClient.pole && !prismaClient.$transaction) {
    opts = prismaClient;
    db = defaultPrisma;
  }
  db = db || defaultPrisma;
  opts = opts || {};

  const affectedPoles = await getPolesForFault(faultType, targetId, db);

  // Load devices for monitored poles
  const monitoredPoleIds = affectedPoles.map(p => p.id);
  const devices = await db.device.findMany({
    where: { pole_id: { in: monitoredPoleIds }, NOT: { pole_id: null } }
  });
  const deviceByPoleId = new Map(devices.map(d => [d.pole_id, d]));

  const seqBase = Date.now() % 2_000_000_000; // keep well within int32 range
  const basePayloads = [];

  for (let i = 0; i < affectedPoles.length; i++) {
    const pole = affectedPoles[i];
    const device = deviceByPoleId.get(pole.id);

    if (!device) {
      // Unmonitored pole — no telemetry emitted (correct)
      continue;
    }

    // Firmware-1.2.x silence: devices with firmware < 1.3 do not emit dying power_lost messages
    if (isFwLegacy(device.fw_version)) {
      // Silent on outage (stops heartbeating only)
      continue;
    }

    // ~30% missing dying message (capacitor failure) on fw >= 1.3 if missingDyingMessage option is set or enabled
    if (opts.missingDyingMessage && isDyingMessageLost(device.id)) {
      continue;
    }

    const payload = buildTelemetryPayload(pole, device, 'power_lost', seqBase + i);
    basePayloads.push(payload);
  }

  // Apply noise transformations (duplicate resends, reordering)
  const finalPayloads = applyNoiseToPayloads(basePayloads, opts);

  let telemetrySent = 0;
  for (const payload of finalPayloads) {
    const resp = await fetch(`${telemetryBaseUrl}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      throw new Error(`Telemetry POST failed for pole ${payload.pole_id}: ${resp.status} ${await resp.text()}`);
    }
    telemetrySent++;
  }

  // Record fault in SimulatorFault
  const faultId = randomUUID();
  await db.simulatorFault.create({
    data: {
      id: faultId,
      type: faultType,
      target: targetId,
    }
  });

  return {
    faultId,
    affectedPoles: affectedPoles.map(p => p.id),
    telemetrySent,
  };
}

/**
 * Repairs a previously injected fault by:
 *   1. Re-deriving the affected pole set from type+target.
 *   2. Computing which poles are STILL PHYSICALLY DARK from any other active
 *      (unrepaired) SimulatorFault — those must NOT receive power_restored.
 *   3. Sending `power_restored` only for poles that become physically energized
 *      after this repair, i.e. not covered by any remaining active fault.
 *   4. Stamping repaired_at on the SimulatorFault record.
 *
 * Physical-state correctness rule:
 *   A pole is physically energized after repair only if NO other active fault
 *   covers it. If fault A covers [pole-1, pole-2] and fault B covers [pole-2],
 *   repairing A must send power_restored for pole-1 but NOT pole-2 (still dark
 *   under fault B). Repairing B afterward restores pole-2.
 *
 * @param {string} faultId
 * @param {string} telemetryBaseUrl
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 * @returns {Promise<{ faultId: string; repairedPoles: string[]; skippedStillDark: string[]; telemetrySent: number }>}
 */
export async function repairFault(faultId, telemetryBaseUrl, prismaClient) {
  const db = prismaClient || defaultPrisma;

  const fault = await db.simulatorFault.findUnique({ where: { id: faultId } });
  if (!fault) throw new Error(`SimulatorFault ${faultId} not found.`);
  if (fault.repaired_at) throw new Error(`SimulatorFault ${faultId} is already repaired.`);

  const affectedPoles = await getPolesForFault(fault.type, fault.target, db);

  // ── Compute the "still-dark" set from all OTHER active faults ─────────────
  // A pole remains physically dark if any other unrepaired fault covers it.
  const otherActiveFaults = await db.simulatorFault.findMany({
    where: {
      id: { not: faultId },
      repaired_at: null,
    }
  });

  const stillDarkPoleIds = new Set();
  for (const otherFault of otherActiveFaults) {
    const otherAffectedPoles = await getPolesForFault(otherFault.type, otherFault.target, db);
    for (const p of otherAffectedPoles) {
      stillDarkPoleIds.add(p.id);
    }
  }

  // ── Load devices for monitored poles ──────────────────────────────────────
  const monitoredPoleIds = affectedPoles.map(p => p.id);
  const devices = await db.device.findMany({
    where: { pole_id: { in: monitoredPoleIds }, NOT: { pole_id: null } }
  });
  const deviceByPoleId = new Map(devices.map(d => [d.pole_id, d]));

  let telemetrySent = 0;
  const skippedStillDark = [];
  const seqBase = Date.now() % 2_000_000_000;

  for (let i = 0; i < affectedPoles.length; i++) {
    const pole = affectedPoles[i];
    const device = deviceByPoleId.get(pole.id);
    if (!device) continue; // unmonitored pole — no telemetry

    if (stillDarkPoleIds.has(pole.id)) {
      // This pole is still covered by another active fault — do not restore it
      skippedStillDark.push(pole.id);
      continue;
    }

    const payload = buildTelemetryPayload(pole, device, 'power_restored', seqBase + i);

    const resp = await fetch(`${telemetryBaseUrl}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      throw new Error(`Telemetry POST failed for pole ${pole.id}: ${resp.status} ${await resp.text()}`);
    }
    telemetrySent++;
  }

  await db.simulatorFault.update({
    where: { id: faultId },
    data: { repaired_at: new Date() }
  });

  return {
    faultId,
    repairedPoles: affectedPoles.map(p => p.id).filter(id => !stillDarkPoleIds.has(id)),
    skippedStillDark,
    telemetrySent,
  };
}

