import { prisma as defaultPrisma } from '../db.js';
import { transitionTicket } from './service.js';

/**
 * Checks whether all monitored poles in a RESOLVED ticket's affected set have
 * been restored to LIVE status according to their latest pole_state record.
 *
 * Rules:
 *  - Poles with NO pole_state record are unmonitored — they are skipped and
 *    do NOT block verification (absence of evidence ≠ evidence of darkness).
 *  - Poles whose pole_state.status is LIVE → restored.
 *  - Poles whose pole_state.status is CONFIRMED_DARK, STALE, OFFLINE_UNKNOWN,
 *    or SENSOR_SUSPECT → still dark; block auto-verification.
 *
 * @param {string} ticketId
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 * @returns {Promise<{ verified: boolean; stillDarkPoleIds: string[] }>}
 */
export async function checkTicketRestoration(ticketId, prismaClient) {
  const db = prismaClient || defaultPrisma;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { incident: true }
  });

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found.`);
  }

  if (ticket.state === 'VERIFIED' || ticket.state === 'CLOSED') {
    throw new Error(`Ticket ${ticketId} is already in a terminal state (current: ${ticket.state}).`);
  }

  const affectedPoleIds = Array.isArray(ticket.incident.affected_pole_ids)
    ? ticket.incident.affected_pole_ids
    : [];

  if (affectedPoleIds.length === 0) {
    // Nothing to check — treat as verified (edge case: incident with no affected poles)
    await transitionTicket(ticketId, 'VERIFIED', { isSystem: true, db });
    return { verified: true, stillDarkPoleIds: [] };
  }

  // Load pole_state for all affected poles in one query
  const poleStates = await db.poleState.findMany({
    where: { pole_id: { in: affectedPoleIds } }
  });

  const poleStateMap = new Map(poleStates.map(ps => [ps.pole_id, ps]));

  const stillDarkPoleIds = [];

  for (const poleId of affectedPoleIds) {
    const ps = poleStateMap.get(poleId);

    if (!ps) {
      // Unmonitored pole — skip, do not treat as dark
      continue;
    }

    if (ps.status !== 'LIVE') {
      stillDarkPoleIds.push(poleId);
    }
  }

  if (stillDarkPoleIds.length > 0) {
    // Cannot verify — surface the still-dark poles for operator visibility
    await db.ticket.update({
      where: { id: ticketId },
      data: { still_dark_pole_ids: stillDarkPoleIds }
    });
    return { verified: false, stillDarkPoleIds };
  }

  // All monitored poles are LIVE — auto-verify
  await db.ticket.update({
    where: { id: ticketId },
    data: { still_dark_pole_ids: null }
  });
  await transitionTicket(ticketId, 'VERIFIED', { isSystem: true, db });
  return { verified: true, stillDarkPoleIds: [] };
}

/**
 * Scans ALL tickets currently in RESOLVED state and runs restoration checks
 * on each one. Intended to be called periodically (e.g. every 60 seconds).
 *
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 * @returns {Promise<{ ticketId: string; verified: boolean; stillDarkPoleIds: string[] }[]>}
 */
export async function runRestorationVerifier(prismaClient) {
  const db = prismaClient || defaultPrisma;

  const activeTickets = await db.ticket.findMany({
    where: { state: { notIn: ['VERIFIED', 'CLOSED'] } },
    select: { id: true }
  });

  const results = [];

  for (const { id } of activeTickets) {
    try {
      const result = await checkTicketRestoration(id, db);
      results.push({ ticketId: id, ...result });
    } catch (err) {
      // Log but don't abort the whole scan for one bad ticket
      console.error(`[RestorationVerifier] Error checking ticket ${id}:`, err.message);
      results.push({ ticketId: id, verified: false, stillDarkPoleIds: [], error: err.message });
    }
  }

  return results;
}
