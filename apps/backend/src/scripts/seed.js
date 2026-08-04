/**
 * @file seed.js
 *
 * Idempotent seed-on-start script.
 *
 * Runs on container startup (wired as the backend entrypoint before `node src/index.js`).
 * Generates the synthetic ground-truth network, exports the department-visible
 * registry, and persists it to the database — ONLY if the DB is not yet seeded.
 *
 * Idempotency guard: checks for the existence of any Feeder row. If rows exist,
 * the script exits immediately without touching the DB. This is safe because:
 *   - The only writer is this script (run once at startup).
 *   - A second container restart simply detects existing data and skips.
 *   - To force a reseed, run with FORCE_RESEED=1 or clear the DB manually.
 *
 * Schema boundary enforced here:
 *   - Ground-truth tables (sim_true_topology, sim_pole_physical_state) do NOT
 *     exist in the Prisma schema — ground-truth is in-memory JS only.
 *   - Registry tables (feeders, transformers, poles, devices) are populated
 *     with the exported view; MISSING-topology parent_pole_id is already null.
 */

import { PrismaClient } from '@prisma/client';
import { generateGroundTruthNetwork } from './generate-ground-truth.js';
import { exportRegistry } from './export-registry.js';

const prisma = new PrismaClient();

/** How many rows to insert per transaction batch (avoids huge single transactions). */
const BATCH_SIZE = 500;

/**
 * Inserts an array of records in batches using the provided Prisma model method.
 * @template T
 * @param {(data: T) => Promise<unknown>} createFn  e.g. prisma.pole.create
 * @param {T[]} records
 */
async function batchInsert(createFn, records) {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((record) => createFn({ data: record })));
  }
}

async function seed() {
  const forceReseed = process.env.FORCE_RESEED === '1';

  // ── Idempotency check ────────────────────────────────────────────────────
  const existingFeederCount = await prisma.feeder.count();
  if (existingFeederCount > 0 && !forceReseed) {
    console.log(
      `[seed] Database already seeded (${existingFeederCount} feeders found). Skipping.`
    );
    console.log('[seed] Set FORCE_RESEED=1 to wipe and re-seed.');
    return;
  }

  if (forceReseed && existingFeederCount > 0) {
    console.log('[seed] FORCE_RESEED=1 detected — clearing existing data...');
    // Delete in dependency order (tickets → incidents → pole_states, then registry)
    await prisma.ticket.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.poleState.deleteMany();
    await prisma.telemetryInbox.deleteMany();
    await prisma.topologyEdge.deleteMany();
    await prisma.scheduledOutage.deleteMany();
    await prisma.simulatorFault.deleteMany();
    await prisma.simTrueTopology.deleteMany();
    await prisma.device.deleteMany();
    await prisma.pole.deleteMany();
    await prisma.transformer.deleteMany();
    await prisma.feeder.deleteMany();
    console.log('[seed] Cleared. Re-seeding...');
  }

  // ── Generate ground truth (in-memory only) ───────────────────────────────
  console.log('[seed] Generating synthetic ground-truth network...');
  const groundTruth = generateGroundTruthNetwork();

  // ── Derive registry (MISSING-topology parent_pole_id stripped) ───────────
  console.log('[seed] Exporting department-visible registry...');
  const registry = exportRegistry(groundTruth);

  console.log('[seed] Network stats:');
  console.log(`  Feeders:           ${registry.feeders.length}`);
  console.log(`  Transformers (DT): ${registry.transformers.length}`);
  console.log(`  Poles:             ${registry.poles.length}`);
  console.log(`  Devices:           ${registry.devices.length}`);

  const recorded = registry.transformers.filter((dt) => dt.topology_source === 'RECORDED').length;
  const missing = registry.transformers.filter((dt) => dt.topology_source === 'MISSING').length;
  console.log(`  Topology RECORDED: ${recorded} | MISSING: ${missing}`);

  // ── Persist registry to database ─────────────────────────────────────────
  console.log('[seed] Inserting Feeders...');
  await batchInsert((args) => prisma.feeder.create(args), registry.feeders);

  console.log('[seed] Inserting Transformers...');
  await batchInsert((args) => prisma.transformer.create(args), registry.transformers);

  console.log('[seed] Inserting Poles...');
  await batchInsert((args) => prisma.pole.create(args), registry.poles);

  console.log('[seed] Inserting Devices...');
  await batchInsert((args) => prisma.device.create(args), registry.devices);

  console.log('[seed] Inserting Simulator True Topology...');
  const simTopologyRows = groundTruth.poles.map(p => ({
    pole_id: p.id,
    parent_pole_id: p.parent_pole_id
  }));
  await batchInsert((args) => prisma.simTrueTopology.create(args), simTopologyRows);

  console.log('[seed] Initializing PoleStates (LIVE) for monitored poles...');
  const initialPoleStates = registry.devices.map(d => ({
    pole_id: d.pole_id,
    status: 'LIVE',
    last_confirmed_at: new Date(),
    last_event_seq: 0,
    evidence_summary: 'Initial state',
    evidence_type: 'initial'
  }));
  await batchInsert((args) => prisma.poleState.create(args), initialPoleStates);

  console.log('[seed] ✅ Seeding complete.');
}

seed()
  .catch((err) => {
    console.error('[seed] ❌ Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
