import { PrismaClient } from '@prisma/client';
import { buildAllAuthoritativeTrees } from '../topology/authoritative.js';
import { buildAllInferredTrees } from '../topology/inferred.js';

const prisma = new PrismaClient();

async function buildTopology() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(42424242)`;

    console.log('[build-topology] Fetching network...');
    const transformers = await tx.transformer.findMany();
    const poles = await tx.pole.findMany();

    console.log('[build-topology] Building AUTHORITATIVE trees...');
    const { edges: authEdges } = buildAllAuthoritativeTrees(transformers, poles);

    console.log('[build-topology] Inferring MISSING trees...');
    const { edges: infEdges } = buildAllInferredTrees(transformers, poles);

    const edgeByKey = new Map();
    for (const edge of [...authEdges, ...infEdges]) {
      edgeByKey.set(`${edge.parent_pole_id}->${edge.child_pole_id}`, edge);
    }
    const allEdges = Array.from(edgeByKey.values());
    console.log(`[build-topology] Saving ${allEdges.length} edges...`);

    await tx.topologyEdge.deleteMany();

    // Insert in batches
    const BATCH_SIZE = 500;
    for (let i = 0; i < allEdges.length; i += BATCH_SIZE) {
      const batch = allEdges.slice(i, i + BATCH_SIZE);
      await tx.topologyEdge.createMany({ data: batch });
    }
  }, { timeout: 120_000, maxWait: 120_000 });

  console.log('[build-topology] ✅ Topology build complete.');
}

buildTopology()
  .catch(err => {
    console.error('[build-topology] ❌ Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
