import { PrismaClient } from '@prisma/client';
import { evaluateTimeout } from '../localization/pole-state.js';
import { runLocalizationForDt } from '../localization/orchestrator.js';
import { syncIncidents } from '../localization/incident-sync.js';

const prisma = new PrismaClient();

export async function sweepTimeouts() {
  const now = new Date().getTime();
  
  // Find poles waiting for debounce
  const poles = await prisma.poleState.findMany({
    where: {
      status: 'LIVE',
      candidate_dark_since: { not: null }
    }
  });

  for (const pole of poles) {
    // Check if debounce is met (we don't strictly need deviceRecord for debounce, but evaluateTimeout expects it for heartbeat checks)
    const device = await prisma.device.findFirst({ where: { pole_id: pole.pole_id } });
    const newState = evaluateTimeout(pole, device, now);

    if (newState && newState.status === 'CONFIRMED_DARK') {
      await prisma.$transaction(async (tx) => {
        // Double check state hasn't changed
        const current = await tx.poleState.findUnique({ where: { pole_id: pole.pole_id } });
        if (current && current.status === 'LIVE' && current.candidate_dark_since) {
          await tx.poleState.update({
            where: { pole_id: pole.pole_id },
            data: {
              status: newState.status,
              candidate_dark_since: null,
              last_confirmed_at: new Date(newState.last_confirmed_at),
              evidence_summary: newState.evidence_summary,
              evidence_type: newState.evidence_type
            }
          });

          const p = await tx.pole.findUnique({ where: { id: pole.pole_id } });
          if (p && p.dt_id) {
            const { incidents } = await runLocalizationForDt(p.dt_id, tx);
            await syncIncidents(incidents, p.dt_id, tx);
          }
        }
      });
    }
  }
}
