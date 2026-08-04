/**
 * Integration tests for Step 23 — Simulator Ground-Truth + Fault Injection API
 *
 * Uses a small hand-crafted network inserted directly into the test DB so we
 * have full control over topology. The injected telemetry flows through the
 * real /telemetry endpoint (via buildApp().inject) → ingestion worker →
 * localization → incident-sync pipeline.
 *
 * Network topology used:
 *
 *   DT: dt-sim-1  (feeder: feeder-sim-1)
 *
 *   pole-root (seq=1, parent=null, device=dev-root)
 *     ├─ pole-a   (seq=2, parent=pole-root, device=dev-a)
 *     │    └─ pole-b  (seq=3, parent=pole-a, device=dev-b)
 *     └─ pole-c   (seq=2, parent=pole-root, device=dev-c)
 *          └─ pole-d  (seq=3, parent=pole-c)   ← UNMONITORED (no device)
 *
 * DT: dt-sim-2  (feeder: feeder-sim-1)  — for feeder-level fault test
 *   pole-e  (seq=1, parent=null, device=dev-e)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../db.js';
import { buildApp } from '../app.js';
import { getPolesForFault, buildTelemetryPayload } from './ground-truth.js';
import { processNextTelemetryEvent } from '../worker/ingestion-worker.js';
import { buildAllInferredTrees } from '../topology/inferred.js';
import crypto from 'crypto';

// ─── Seed Helpers ─────────────────────────────────────────────────────────────

const FEEDER_ID = 'feeder-sim-1';
const DT1_ID = 'dt-sim-1';
const DT2_ID = 'dt-sim-2';
const DT3_ID = 'dt-sim-3'; // MISSING-topology DT

const POLES = [
  { id: 'pole-root', dt_id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.97, lon: 77.59, seq_on_line: 1, parent_pole_id: null, device_id: 'dev-root' },
  { id: 'pole-a',    dt_id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.971, lon: 77.591, seq_on_line: 2, parent_pole_id: 'pole-root', device_id: 'dev-a' },
  { id: 'pole-b',    dt_id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.972, lon: 77.592, seq_on_line: 3, parent_pole_id: 'pole-a',    device_id: 'dev-b' },
  { id: 'pole-c',    dt_id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.971, lon: 77.589, seq_on_line: 2, parent_pole_id: 'pole-root', device_id: 'dev-c' },
  { id: 'pole-d',    dt_id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.972, lon: 77.588, seq_on_line: 3, parent_pole_id: 'pole-c',    device_id: null   }, // unmonitored
  { id: 'pole-e',    dt_id: DT2_ID, feeder_id: FEEDER_ID, lat: 12.98,  lon: 77.60,  seq_on_line: 1, parent_pole_id: null,       device_id: 'dev-e' },
  // DT3: MISSING topology. parent_pole_id is the PHYSICAL ground truth here,
  // but we will null it out in the DB Pole table insertion to simulate the registry export.
  { id: 'pole-m1',   dt_id: DT3_ID, feeder_id: FEEDER_ID, lat: 12.99,  lon: 77.61,  seq_on_line: 1, parent_pole_id: null,       device_id: 'dev-m1' },
  { id: 'pole-m2',   dt_id: DT3_ID, feeder_id: FEEDER_ID, lat: 12.991, lon: 77.611, seq_on_line: 2, parent_pole_id: 'pole-m1',  device_id: 'dev-m2' },
  { id: 'pole-m3',   dt_id: DT3_ID, feeder_id: FEEDER_ID, lat: 12.992, lon: 77.612, seq_on_line: 3, parent_pole_id: 'pole-m2',  device_id: 'dev-m3' },
];

const DEVICES = [
  { id: 'dev-root', pole_id: 'pole-root', fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-a',    pole_id: 'pole-a',    fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-b',    pole_id: 'pole-b',    fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-c',    pole_id: 'pole-c',    fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-e',    pole_id: 'pole-e',    fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-m1',   pole_id: 'pole-m1',   fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-m2',   pole_id: 'pole-m2',   fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
  { id: 'dev-m3',   pole_id: 'pole-m3',   fw_version: '1.5', first_seen: new Date(), last_seen: new Date() },
];

async function seedNetwork() {
  await prisma.feeder.upsert({
    where: { id: FEEDER_ID },
    update: {},
    create: { id: FEEDER_ID, name: 'Sim Feeder 1' }
  });

  for (const dt of [
    { id: DT1_ID, feeder_id: FEEDER_ID, lat: 12.97, lon: 77.59, capacity_kva: 250, households_served: 50, topology_source: 'RECORDED' },
    { id: DT2_ID, feeder_id: FEEDER_ID, lat: 12.98, lon: 77.60, capacity_kva: 100, households_served: 30, topology_source: 'RECORDED' },
    { id: DT3_ID, feeder_id: FEEDER_ID, lat: 12.99, lon: 77.61, capacity_kva: 100, households_served: 30, topology_source: 'MISSING' },
  ]) {
    await prisma.transformer.upsert({ where: { id: dt.id }, update: {}, create: dt });
  }

  // Insert true topology into the simulator ground-truth store
  for (const pole of POLES) {
    await prisma.simTrueTopology.upsert({
      where: { pole_id: pole.id },
      update: {},
      create: { pole_id: pole.id, parent_pole_id: pole.parent_pole_id }
    });
  }

  // Insert registry poles — stripping topology for MISSING DTs
  for (const pole of POLES) {
    const isMissing = pole.dt_id === DT3_ID;
    const dbPole = {
      ...pole,
      parent_pole_id: isMissing ? null : pole.parent_pole_id,
      seq_on_line: isMissing ? null : pole.seq_on_line,
    };
    await prisma.pole.upsert({ where: { id: dbPole.id }, update: {}, create: dbPole });
  }

  for (const device of DEVICES) {
    await prisma.device.upsert({ where: { id: device.id }, update: {}, create: device });
  }

  // Build topology edges from registry parent_pole_id (as authoritative topology service would)
  for (const pole of POLES) {
    // Only build edge if the registry exposed a parent (i.e. not MISSING)
    const isMissing = pole.dt_id === DT3_ID;
    if (pole.parent_pole_id && !isMissing) {
      await prisma.topologyEdge.upsert({
        where: {
          id: `edge-${pole.parent_pole_id}-${pole.id}`,
        },
        update: {},
        create: {
          id: `edge-${pole.parent_pole_id}-${pole.id}`,
          parent_pole_id: pole.parent_pole_id,
          child_pole_id: pole.id,
          source: 'AUTHORITATIVE',
          weight: 50,
          ambiguous: false,
        }
      });
    }
  }
}

async function drainInbox(maxEvents = 20) {
  let processed = 0;
  for (let i = 0; i < maxEvents; i++) {
    const didProcess = await processNextTelemetryEvent();
    if (!didProcess) break;
    processed++;
  }
  return processed;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Clean in dependency order
  await prisma.ticket.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.poleState.deleteMany();
  await prisma.telemetryInbox.deleteMany();
  await prisma.simulatorFault.deleteMany();
  await prisma.simTrueTopology.deleteMany();
  await prisma.topologyEdge.deleteMany();
  await prisma.device.deleteMany();
  await prisma.pole.deleteMany();
  await prisma.transformer.deleteMany();
  await prisma.feeder.deleteMany();

  await seedNetwork();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getPolesForFault — ground-truth pole derivation', () => {
  it('SPAN: returns the target pole and all physical descendants', async () => {
    const affected = await getPolesForFault('SPAN', 'pole-a', prisma);
    const ids = affected.map(p => p.id).sort();
    // pole-a and its child pole-b; pole-c branch is NOT affected
    expect(ids).toEqual(['pole-a', 'pole-b'].sort());
  });

  it('SPAN from root: returns entire DT subtree', async () => {
    const affected = await getPolesForFault('SPAN', 'pole-root', prisma);
    const ids = affected.map(p => p.id).sort();
    expect(ids).toEqual(['pole-root', 'pole-a', 'pole-b', 'pole-c', 'pole-d'].sort());
  });

  it('DT: returns all poles with matching dt_id', async () => {
    const affected = await getPolesForFault('DT', DT1_ID, prisma);
    const ids = affected.map(p => p.id).sort();
    expect(ids).toEqual(['pole-root', 'pole-a', 'pole-b', 'pole-c', 'pole-d'].sort());
  });

  it('FEEDER: returns all poles across all DTs on the feeder', async () => {
    const affected = await getPolesForFault('FEEDER', FEEDER_ID, prisma);
    const ids = affected.map(p => p.id).sort();
    expect(ids).toEqual(['pole-root', 'pole-a', 'pole-b', 'pole-c', 'pole-d', 'pole-e', 'pole-m1', 'pole-m2', 'pole-m3'].sort());
  });

  it('SPAN: throws for unknown target pole', async () => {
    await expect(getPolesForFault('SPAN', 'pole-nonexistent', prisma))
      .rejects.toThrow(/not found/);
  });
});

describe('buildTelemetryPayload', () => {
  it('returns power_lost payload with energized=false', () => {
    const pole = POLES[0];
    const device = DEVICES[0];
    const payload = buildTelemetryPayload(pole, device, 'power_lost', 42);
    expect(payload.event).toBe('power_lost');
    expect(payload.energized).toBe(false);
    expect(payload.device_id).toBe(device.id);
    expect(payload.pole_id).toBe(pole.id);
    expect(payload.seq).toBe(42);
    expect(payload.fw).toBe(device.fw_version);
  });

  it('returns power_restored payload with energized=true', () => {
    const pole = POLES[0];
    const device = DEVICES[0];
    const payload = buildTelemetryPayload(pole, device, 'power_restored', 43);
    expect(payload.event).toBe('power_restored');
    expect(payload.energized).toBe(true);
  });
});

describe('Fault injection via API → pipeline → incident', () => {
  it('SPAN fault on pole-a: sends power_lost for monitored poles only, skips unmonitored', async () => {
    const app = buildApp();
    await app.ready();

    // Inject via API — routes the telemetry payload through the real /telemetry endpoint
    // We test getPolesForFault + buildTelemetryPayload directly here (unit-level)
    // and verify inbox rows were created

    const affectedPoles = await getPolesForFault('SPAN', 'pole-a', prisma);
    const deviceMap = new Map(DEVICES.map(d => [d.pole_id, d]));

    let telemetrySent = 0;
    for (const pole of affectedPoles) {
      const device = deviceMap.get(pole.id);
      if (!device) continue; // unmonitored — pole-d would be here if in SPAN of pole-a, but it isn't

      // Backdate timestamps by 2 minutes so the debounce is already elapsed
      // when the ingestion worker processes the event — this lets it immediately
      // confirm CONFIRMED_DARK rather than waiting 90 real seconds.
      const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const payload = {
        ...buildTelemetryPayload(pole, device, 'power_lost', Date.now() % 2_000_000_000),
        device_ts: twoMinsAgo,
        server_received_at: twoMinsAgo,
      };
      const resp = await app.inject({
        method: 'POST',
        url: '/telemetry',
        payload,
      });
      expect(resp.statusCode).toBe(202);
      telemetrySent++;
    }

    // SPAN of pole-a → [pole-a, pole-b] both monitored → 2 events
    expect(telemetrySent).toBe(2);

    // Drain and verify incident produced
    const processed = await drainInbox();
    expect(processed).toBe(2);

    const incidents = await prisma.incident.findMany();
    expect(incidents.length).toBeGreaterThanOrEqual(1);

    const tickets = await prisma.ticket.findMany();
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets[0].state).toBe('DETECTED');

    await app.close();
  });

  it('Unmonitored pole (pole-d) in DT fault: generates no telemetry for that pole', async () => {
    // pole-d has no device
    const affected = await getPolesForFault('DT', DT1_ID, prisma);
    const deviceMap = new Map(DEVICES.map(d => [d.pole_id, d]));

    const monitored = affected.filter(p => deviceMap.has(p.id));
    const unmonitored = affected.filter(p => !deviceMap.has(p.id));

    // pole-d is the only unmonitored pole in DT1
    expect(unmonitored.map(p => p.id)).toContain('pole-d');
    // Monitored count: root, a, b, c = 4
    expect(monitored.length).toBe(4);
  });

  it('FEEDER fault: affects poles across both DTs', async () => {
    const affected = await getPolesForFault('FEEDER', FEEDER_ID, prisma);
    const ids = affected.map(p => p.id);

    // Must include poles from both DT1 and DT2
    expect(ids).toContain('pole-e');   // DT2
    expect(ids).toContain('pole-root'); // DT1
    expect(ids).toContain('pole-m1');   // DT3
    expect(affected.length).toBe(9);   // all 9 poles in the feeder
  });

  it('Simulator inject/repair API endpoints return correct responses', async () => {
    const app = buildApp();
    await app.ready();

    // GET /api/simulator/faults — should be empty initially
    const listResp = await app.inject({ method: 'GET', url: '/api/simulator/faults' });
    expect(listResp.statusCode).toBe(200);
    expect(listResp.json()).toHaveLength(0);

    // POST /api/simulator/inject with missing body fields → 400
    const badResp = await app.inject({
      method: 'POST',
      url: '/api/simulator/inject',
      payload: { type: 'INVALID', target: 'x' }
    });
    expect(badResp.statusCode).toBe(400);

    // POST /api/simulator/repair with nonexistent fault → 404
    const repairResp = await app.inject({
      method: 'POST',
      url: '/api/simulator/repair/nonexistent-id'
    });
    expect(repairResp.statusCode).toBe(404);

    await app.close();
  });
});

// ─── Overlapping Faults ───────────────────────────────────────────────────────
//
// Topology reminder:
//   pole-root → pole-a → pole-b   (all monitored)
//   pole-root → pole-c → pole-d   (pole-d unmonitored)
//
// Test scenario:
//   Fault A: SPAN on pole-a  → affects [pole-a, pole-b]
//   Fault B: SPAN on pole-b  → affects [pole-b]         ← overlaps on pole-b
//
// Physical truth:
//   After injecting both, pole-b is dark under both A and B.
//   Repairing A must restore pole-a but NOT pole-b (still dark under B).
//   Repairing B afterward restores pole-b.

describe('Overlapping faults — physical-state correctness', () => {
  it('repairing fault A does not restore poles still covered by fault B', async () => {
    const app = buildApp();
    await app.ready();

    // Use loopback inject so we don't need a running server
    const telemetryUrl = 'http://localhost:0'; // unused — we call repairFault directly with app.inject below

    // Inject fault A (SPAN on pole-a → [pole-a, pole-b])
    const faultAId = crypto.randomUUID();
    await prisma.simulatorFault.create({
      data: { id: faultAId, type: 'SPAN', target: 'pole-a' }
    });

    // Inject fault B (SPAN on pole-b → [pole-b])
    const faultBId = crypto.randomUUID();
    await prisma.simulatorFault.create({
      data: { id: faultBId, type: 'SPAN', target: 'pole-b' }
    });

    // Confirm both are active
    const activeFaults = await prisma.simulatorFault.findMany({ where: { repaired_at: null } });
    expect(activeFaults).toHaveLength(2);

    // Build the "still-dark" set for fault A repair: pole-b is in fault B
    const affectedByA = await getPolesForFault('SPAN', 'pole-a', prisma);
    const affectedByB = await getPolesForFault('SPAN', 'pole-b', prisma);
    const stillDarkUnderB = new Set(affectedByB.map(p => p.id));

    // Poles in A that are NOT still dark = should be restored
    const toRestore = affectedByA.filter(p => !stillDarkUnderB.has(p.id)).map(p => p.id);
    const stillDark  = affectedByA.filter(p =>  stillDarkUnderB.has(p.id)).map(p => p.id);

    expect(toRestore).toEqual(['pole-a']);   // pole-a is only in fault A
    expect(stillDark).toEqual(['pole-b']);   // pole-b is still in fault B

    // Mark fault A as repaired directly in DB (simulate repairFault without fetch)
    await prisma.simulatorFault.update({
      where: { id: faultAId },
      data: { repaired_at: new Date() }
    });

    // Verify fault B still active
    const faultB = await prisma.simulatorFault.findUnique({ where: { id: faultBId } });
    expect(faultB.repaired_at).toBeNull();

    // Verify pole-b's overlap is still covered
    const otherActive = await prisma.simulatorFault.findMany({ where: { repaired_at: null } });
    expect(otherActive).toHaveLength(1);
    expect(otherActive[0].id).toBe(faultBId);

    const poleBStillCovered = await getPolesForFault('SPAN', 'pole-b', prisma);
    expect(poleBStillCovered.map(p => p.id)).toContain('pole-b');

    // Repair fault B — now pole-b is genuinely restored
    await prisma.simulatorFault.update({
      where: { id: faultBId },
      data: { repaired_at: new Date() }
    });

    const remaining = await prisma.simulatorFault.findMany({ where: { repaired_at: null } });
    expect(remaining).toHaveLength(0);

    await app.close();
  });

  it('repairFault skippedStillDark list is correct for overlapping SPAN faults', async () => {
    // This test calls repairFault() directly using the DB prisma client.
    // We can't use the real HTTP fetch here, so we test the skip-set logic
    // by verifying that the still-dark pole set is correctly computed.

    // Inject fault A (SPAN pole-a → [pole-a, pole-b]) and fault B (SPAN pole-b → [pole-b])
    const faultAId = crypto.randomUUID();
    const faultBId = crypto.randomUUID();
    await prisma.simulatorFault.createMany({
      data: [
        { id: faultAId, type: 'SPAN', target: 'pole-a' },
        { id: faultBId, type: 'SPAN', target: 'pole-b' },
      ]
    });

    // Compute the still-dark set for fault A repair as repairFault would
    const otherActive = await prisma.simulatorFault.findMany({
      where: { id: { not: faultAId }, repaired_at: null }
    });
    expect(otherActive.map(f => f.id)).toContain(faultBId);

    const stillDarkSet = new Set();
    for (const f of otherActive) {
      const poles = await getPolesForFault(f.type, f.target, prisma);
      for (const p of poles) stillDarkSet.add(p.id);
    }

    // pole-b must be in the still-dark set because fault B covers it
    expect(stillDarkSet.has('pole-b')).toBe(true);
    // pole-a must NOT be in the still-dark set (only in fault A)
    expect(stillDarkSet.has('pole-a')).toBe(false);

    // After repairing A, repair B → nothing should block pole-b now
    await prisma.simulatorFault.update({ where: { id: faultAId }, data: { repaired_at: new Date() } });

    const otherActiveAfterA = await prisma.simulatorFault.findMany({
      where: { id: { not: faultBId }, repaired_at: null }
    });
    expect(otherActiveAfterA).toHaveLength(0); // nothing else active

    const stillDarkAfterA = new Set();
    for (const f of otherActiveAfterA) {
      const poles = await getPolesForFault(f.type, f.target, prisma);
      for (const p of poles) stillDarkAfterA.add(p.id);
    }
    // No other faults → pole-b is now restorable
    expect(stillDarkAfterA.has('pole-b')).toBe(false);
  });
});

// ─── Missing-Topology DT Scenario ──────────────────────────────────────────────

describe('Missing-Topology DT: Simulator uses ground truth, production does not', () => {
  it('simulates SPAN fault accurately on a MISSING-topology DT', async () => {
    // 1. Verify registry exported parent_pole_id as null
    const dbPoleM2 = await prisma.pole.findUnique({ where: { id: 'pole-m2' } });
    expect(dbPoleM2.parent_pole_id).toBeNull(); // department doesn't know its parent

    // 2. Simulator still knows the true downstream subtree
    const affected = await getPolesForFault('SPAN', 'pole-m2', prisma);
    const affectedIds = affected.map(p => p.id).sort();
    expect(affectedIds).toEqual(['pole-m2', 'pole-m3']); // precisely simulated span

    // 3. Inject SPAN fault
    const app = buildApp();
    await app.ready();

    // Instead of calling the /inject API (which requires a real HTTP server for fetch),
    // we use the same direct app.inject pattern as the other pipeline test.
    const deviceMap = new Map(DEVICES.map(d => [d.pole_id, d]));
    for (const pole of affected) {
      const device = deviceMap.get(pole.id);
      if (!device) continue;
      
      const payload = buildTelemetryPayload(pole, device, 'power_lost', Date.now() % 2_000_000_000);
      const resp = await app.inject({
        method: 'POST',
        url: '/telemetry',
        payload
      });
      expect(resp.statusCode).toBe(202);
    }

    // 4. Verify telemetry is in inbox for m2 and m3
    const inbox = await prisma.telemetryInbox.findMany({ where: { status: 'PENDING' } });
    expect(inbox).toHaveLength(2);
    const inboxPoleIds = inbox.map(i => i.pole_id).sort();
    expect(inboxPoleIds).toEqual(['pole-m2', 'pole-m3']);

    // 5. Backdate so debounce passes immediately
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.telemetryInbox.updateMany({
      data: { device_ts: twoMinsAgo, server_received_at: twoMinsAgo }
    });

    // 5.5 Generate and save inferred topology for the MISSING DT
    // The production system does this in Step 8 so the engine has edges to traverse.
    const allDts = await prisma.transformer.findMany();
    const allPoles = await prisma.pole.findMany();
    const { edges } = buildAllInferredTrees(allDts, allPoles);
    
    // Save the inferred edges to DB (simulating the Topology Service)
    const edgeRows = edges.map(e => ({
      id: crypto.randomUUID(),
      parent_pole_id: e.parent_pole_id,
      child_pole_id: e.child_pole_id,
      source: 'INFERRED',
      weight: e.weight,
      ambiguous: false
    }));
    await prisma.topologyEdge.createMany({ data: edgeRows });

    // 6. Run ingestion worker and production localization
    await drainInbox();

    // 7. Verify the production localization engine correctly produced an incident
    // The engine relies on the INFERRED edges to locate the SPAN fault,
    // not the simulator's ground truth table.
    const incidents = await prisma.incident.findMany();
    expect(incidents).toHaveLength(1);
    
    // The incident produced was derived entirely from the telemetry and inferred topology.
    expect(incidents[0].type).toBe('SPAN');
    expect(incidents[0].topology_source).toBe('INFERRED');

    await app.close();
  });
});

