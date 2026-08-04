import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db.js';
import { checkTicketRestoration, runRestorationVerifier } from './restoration-verifier.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedIncidentAndTicket({ poleIds = [], state = 'RESOLVED' } = {}) {
  const incidentId = `inc-rv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ticketId   = `tick-rv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await prisma.incident.create({
    data: {
      id: incidentId,
      type: 'DT',
      affected_count: poleIds.length,
      downstream_dark_pole_ids: poleIds,
      affected_pole_ids: poleIds,
      historical_affected_pole_ids: poleIds,
      topology_source: 'AUTHORITATIVE',
      confidence: 'HIGH',
      confidence_reasons: []
    }
  });

  const ticketData = {
    id: ticketId,
    incident_id: incidentId,
    state
  };
  if (state === 'RESOLVED') ticketData.resolved_at = new Date();

  await prisma.ticket.create({ data: ticketData });

  return { incidentId, ticketId };
}

async function setPoleState(poleId, status) {
  await prisma.poleState.upsert({
    where: { pole_id: poleId },
    update: {
      status,
      last_confirmed_at: new Date(),
      last_event_seq: 1,
      evidence_summary: `test:${status}`,
      evidence_type: 'test'
    },
    create: {
      pole_id: poleId,
      status,
      last_confirmed_at: new Date(),
      last_event_seq: 1,
      evidence_summary: `test:${status}`,
      evidence_type: 'test'
    }
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await prisma.ticket.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.poleState.deleteMany();
});

afterAll(async () => {
  await prisma.ticket.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.poleState.deleteMany();
});

// ─── Test Matrix Row 17 ───────────────────────────────────────────────────────
// Repair → all affected monitored poles report LIVE → ticket auto-transitions to VERIFIED

describe('Row 17: Repair verified — all monitored poles LIVE', () => {
  it('auto-transitions RESOLVED ticket to VERIFIED when all affected poles are LIVE', async () => {
    const poleIds = ['pole-rv-A', 'pole-rv-B', 'pole-rv-C'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    // All poles restored
    for (const id of poleIds) {
      await setPoleState(id, 'LIVE');
    }

    const result = await checkTicketRestoration(ticketId);

    expect(result.verified).toBe(true);
    expect(result.stillDarkPoleIds).toHaveLength(0);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('VERIFIED');
    expect(ticket.verified_at).toBeTruthy();
    expect(ticket.still_dark_pole_ids).toBeNull();
  });

  it('skips unmonitored poles (no PoleState record) and still verifies if all monitored ones are LIVE', async () => {
    const monitoredPoles = ['pole-rv-M1', 'pole-rv-M2'];
    const unmonitoredPole = 'pole-rv-UNMONITORED';
    const poleIds = [...monitoredPoles, unmonitoredPole];

    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    // Only monitored poles have pole_state entries
    for (const id of monitoredPoles) {
      await setPoleState(id, 'LIVE');
    }
    // unmonitoredPole intentionally has no PoleState record

    const result = await checkTicketRestoration(ticketId);

    expect(result.verified).toBe(true);
    expect(result.stillDarkPoleIds).toHaveLength(0);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('VERIFIED');
  });

  it('runRestorationVerifier auto-verifies all RESOLVED tickets with all-LIVE poles', async () => {
    const poleIds = ['pole-batch-A', 'pole-batch-B'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    for (const id of poleIds) await setPoleState(id, 'LIVE');

    const results = await runRestorationVerifier();
    const ticketResult = results.find(r => r.ticketId === ticketId);

    expect(ticketResult).toBeDefined();
    expect(ticketResult.verified).toBe(true);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('VERIFIED');
  });
});

// ─── Test Matrix Row 18 ───────────────────────────────────────────────────────
// Mark RESOLVED while poles still dark → not verified, still_dark_pole_ids populated

describe('Row 18: Poles still dark — verification refused', () => {
  it('does NOT verify and populates still_dark_pole_ids when affected pole is CONFIRMED_DARK', async () => {
    const poleIds = ['pole-rv-D1', 'pole-rv-D2'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    // D1 is LIVE, D2 remains dark
    await setPoleState('pole-rv-D1', 'LIVE');
    await setPoleState('pole-rv-D2', 'CONFIRMED_DARK');

    const result = await checkTicketRestoration(ticketId);

    expect(result.verified).toBe(false);
    expect(result.stillDarkPoleIds).toContain('pole-rv-D2');
    expect(result.stillDarkPoleIds).not.toContain('pole-rv-D1');

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('RESOLVED'); // Must not advance to VERIFIED
    expect(ticket.still_dark_pole_ids).toContain('pole-rv-D2');
  });

  it('refuses verification for STALE and OFFLINE_UNKNOWN poles as well', async () => {
    const poleIds = ['pole-stale-1', 'pole-offline-1'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    await setPoleState('pole-stale-1', 'STALE');
    await setPoleState('pole-offline-1', 'OFFLINE_UNKNOWN');

    const result = await checkTicketRestoration(ticketId);

    expect(result.verified).toBe(false);
    expect(result.stillDarkPoleIds).toEqual(
      expect.arrayContaining(['pole-stale-1', 'pole-offline-1'])
    );

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('RESOLVED');
  });

  it('does NOT surface already-LIVE or unmonitored poles in still_dark_pole_ids', async () => {
    const poleIds = ['pole-live-X', 'pole-dark-X', 'pole-unmon-X'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });

    await setPoleState('pole-live-X', 'LIVE');
    await setPoleState('pole-dark-X', 'CONFIRMED_DARK');
    // pole-unmon-X has no PoleState record

    const result = await checkTicketRestoration(ticketId);

    expect(result.stillDarkPoleIds).toEqual(['pole-dark-X']);
  });

  it('runRestorationVerifier leaves RESOLVED tickets untouched when poles are still dark', async () => {
    const poleIds = ['pole-batch-dark-1'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds });
    await setPoleState('pole-batch-dark-1', 'CONFIRMED_DARK');

    const results = await runRestorationVerifier();
    const ticketResult = results.find(r => r.ticketId === ticketId);

    expect(ticketResult.verified).toBe(false);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.state).toBe('RESOLVED');
  });

  it('throws if ticket is not in RESOLVED state', async () => {
    const poleIds = ['pole-rv-E'];
    const { ticketId } = await seedIncidentAndTicket({ poleIds, state: 'DETECTED' });

    await expect(checkTicketRestoration(ticketId)).rejects.toThrow(/not in RESOLVED state/);
  });
});
