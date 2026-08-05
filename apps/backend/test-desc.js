import { PrismaClient } from '@prisma/client';
import { buildAdjacency } from './src/localization/frontier.js';

const prisma = new PrismaClient();
async function main() {
  const edges = await prisma.topologyEdge.findMany();
  const { childrenOf } = buildAdjacency(edges);
  
  const descendants = new Set();
  const queue = ['pole-10'];
  while (queue.length > 0) {
    const curr = queue.shift();
    descendants.add(curr);
    for (const child of childrenOf.get(curr) || []) {
      queue.push(child);
    }
  }
  
  const states = await prisma.poleState.findMany({ where: { pole_id: { in: Array.from(descendants) }, status: 'LIVE' } });
  console.log(states.map(s => s.pole_id));
}
main().finally(() => prisma.$disconnect());
