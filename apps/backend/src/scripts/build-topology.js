import { PrismaClient } from '@prisma/client';
import { buildAllAuthoritativeTrees } from '../topology/authoritative.js';
import { buildAllInferredTrees } from '../topology/inferred.js';

const prisma = new PrismaClient();

async function buildTopology() {
  console.log('[build-topology] Fetching network...');
  const transformers = await prisma.transformer.findMany();
  const poles = await prisma.pole.findMany();

  console.log('[build-topology] Building AUTHORITATIVE trees...');
  const { edges: authEdges } = buildAllAuthoritativeTrees(transformers, poles);

  console.log('[build-topology] Inferring MISSING trees...');
  const { edges: infEdges } = buildAllInferredTrees(transformers, poles);

  const allEdges = [...authEdges, ...infEdges];
  console.log(`[build-topology] Saving ${allEdges.length} edges...`);

  await prisma.topologyEdge.deleteMany();

  // Insert in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < allEdges.length; i += BATCH_SIZE) {
    const batch = allEdges.slice(i, i + BATCH_SIZE);
    await prisma.topologyEdge.createMany({ data: batch });
  }

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
