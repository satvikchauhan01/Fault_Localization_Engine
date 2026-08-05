import { PrismaClient } from '@prisma/client';
import { evaluateTimeout } from '../localization/pole-state.js';
import { runLocalizationForDt } from '../localization/orchestrator.js';
import { syncIncidents } from '../localization/incident-sync.js';

const prisma = new PrismaClient();

export async function sweepTimeouts() {
  const now = new Date().getTime();
  
  // 1. Find poles waiting for debounce
  const debouncingPoles = await prisma.poleState.findMany({
    where: {
      status: 'LIVE',
      candidate_dark_since: { not: null }
    }
  });

  // 2. Find poles that have missed their heartbeat (Rule 4)
  // Heartbeat timeout is 10 minutes (600,000 ms). Let's use evaluateTimeout to confirm.
  const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
  const timeoutThreshold = new Date(now - HEARTBEAT_TIMEOUT_MS);
  
  const staleDevices = await prisma.device.findMany({
    where: {
      last_seen: { lt: timeoutThreshold }
    }
  });
  
  const stalePoleIds = staleDevices.filter(d => d.pole_id !== null).map(d => d.pole_id);
  
  const stalePoles = stalePoleIds.length > 0 ? await prisma.poleState.findMany({
    where: {
      pole_id: { in: stalePoleIds },
      status: 'LIVE'
    }
  }) : [];

  // Combine and deduplicate
  const poleMap = new Map();
  for (const p of debouncingPoles) poleMap.set(p.pole_id, p);
  for (const p of stalePoles) poleMap.set(p.pole_id, p);

  if (poleMap.size === 0) return;

  const updatedPoles = [];

  for (const pole of poleMap.values()) {
    const device = await prisma.device.findFirst({ where: { pole_id: pole.pole_id } });
    const newState = evaluateTimeout(pole, device, now);

    if (newState && newState.status === 'CONFIRMED_DARK') {
      updatedPoles.push({ pole, newState });
    }
  }

  if (updatedPoles.length === 0) return;

  // Group by DT ID
  const dtIdsToLocalize = new Set();

  await prisma.$transaction(async (tx) => {
    for (const { pole, newState } of updatedPoles) {
      // Double check state hasn't changed
      const current = await tx.poleState.findUnique({ where: { pole_id: pole.pole_id } });
      if (current && current.status === 'LIVE') {
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
          dtIdsToLocalize.add(p.dt_id);
        }
      }
    }

    // Now run localization once per affected DT
    for (const dtId of dtIdsToLocalize) {
      const { incidents } = await runLocalizationForDt(dtId, tx);
      await syncIncidents(incidents, dtId, tx);
    }
  });
}
