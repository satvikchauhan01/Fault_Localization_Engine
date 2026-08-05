import { PrismaClient } from '@prisma/client';
import { runLocalizationForDt } from './src/localization/orchestrator.js';
import { syncIncidents } from './src/localization/incident-sync.js';

const prisma = new PrismaClient();

async function main() {
  const { incidents } = await runLocalizationForDt('dt-1', prisma);
  console.log('computed:', incidents.length);
  await prisma.$transaction(async (tx) => {
    await syncIncidents(incidents, 'dt-1', tx);
  });
  console.log('synced');
}

main().finally(() => prisma.$disconnect());
