import { PrismaClient } from '@prisma/client';
import { runLocalizationForDt } from './src/localization/orchestrator.js';

const prisma = new PrismaClient();

async function main() {
  const result = await runLocalizationForDt('dt-1', prisma);
  console.log(JSON.stringify(result, null, 2));
}

main().finally(() => prisma.$disconnect());
