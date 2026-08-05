import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db.js';
import { startWorker, stopWorker } from '../worker/run.js';

// Wait for a condition to be met, polling the DB
async function waitForCondition(checkFn, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await checkFn();
    if (result) return result;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Condition not met within timeout');
}

describe('Background Restoration Verifier Integration', { timeout: 40000 }, () => {
  afterAll(async () => {
    // Ensure worker loop is stopped so tests don't hang
    stopWorker();
    
    // Clean up test data
    await prisma.ticket.deleteMany({ where: { id: { startsWith: 'tick-bg-' } } });
    await prisma.incident.deleteMany({ where: { id: { startsWith: 'inc-bg-' } } });
    await prisma.poleState.deleteMany({ where: { pole_id: { startsWith: 'pole-bg-' } } });
    await prisma.pole.deleteMany({ where: { id: { startsWith: 'pole-bg-' } } });
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany({ where: { id: { startsWith: 'tick-bg-' } } });
    await prisma.incident.deleteMany({ where: { id: { startsWith: 'inc-bg-' } } });
    await prisma.poleState.deleteMany({ where: { pole_id: { startsWith: 'pole-bg-' } } });
    await prisma.pole.deleteMany({ where: { id: { startsWith: 'pole-bg-' } } });
  });

  it('automatically verifies a RESOLVED ticket when background worker runs', async () => {
    const poleId = 'pole-bg-live-1';
    await prisma.pole.create({ data: { id: poleId, dt_id: 'dt-1', feeder_id: 'feeder-1', lat: 0, lon: 0 } });
    
    const incidentId = 'inc-bg-live-1';
    const ticketId = 'tick-bg-live-1';
    
    await prisma.incident.create({
      data: {
        id: incidentId,
        type: 'SPAN',
        affected_count: 1,
        downstream_dark_pole_ids: [poleId],
        affected_pole_ids: [poleId],
        historical_affected_pole_ids: [poleId],
        topology_source: 'AUTHORITATIVE',
        confidence: 'HIGH',
        confidence_reasons: []
      }
    });

    await prisma.ticket.create({
      data: {
        id: ticketId,
        incident_id: incidentId,
        state: 'RESOLVED',
        resolved_at: new Date()
      }
    });

    await prisma.poleState.create({
      data: {
        pole_id: poleId,
        status: 'LIVE', // The pole is LIVE, so the ticket should become VERIFIED
        last_confirmed_at: new Date(),
        last_event_seq: 1,
        evidence_summary: 'test',
        evidence_type: 'TELEMETRY'
      }
    });

    // Start the background worker process (which schedules the intervals)
    startWorker();

    // The verifier interval is 15 seconds. Wait until the DB reflects VERIFIED.
    const finalTicket = await waitForCondition(async () => {
      const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (t && t.state === 'VERIFIED') return t;
      return null;
    });

    expect(finalTicket).toBeDefined();
    expect(finalTicket.state).toBe('VERIFIED');
    expect(finalTicket.still_dark_pole_ids).toBeNull();
  });

  it('keeps the ticket RESOLVED and updates still_dark_pole_ids if a pole is CONFIRMED_DARK', async () => {
    const poleId = 'pole-bg-dark-1';
    await prisma.pole.create({ data: { id: poleId, dt_id: 'dt-1', feeder_id: 'feeder-1', lat: 0, lon: 0 } });
    
    const incidentId = 'inc-bg-dark-1';
    const ticketId = 'tick-bg-dark-1';
    
    await prisma.incident.create({
      data: {
        id: incidentId,
        type: 'SPAN',
        affected_count: 1,
        downstream_dark_pole_ids: [poleId],
        affected_pole_ids: [poleId],
        historical_affected_pole_ids: [poleId],
        topology_source: 'AUTHORITATIVE',
        confidence: 'HIGH',
        confidence_reasons: []
      }
    });

    await prisma.ticket.create({
      data: {
        id: ticketId,
        incident_id: incidentId,
        state: 'RESOLVED',
        resolved_at: new Date()
      }
    });

    await prisma.poleState.create({
      data: {
        pole_id: poleId,
        status: 'CONFIRMED_DARK', // This will prevent verification
        last_confirmed_at: new Date(),
        last_event_seq: 1,
        evidence_summary: 'test',
        evidence_type: 'TELEMETRY'
      }
    });

    // Worker is presumably still running from the previous test, but we can call startWorker again 
    // it resets isShuttingDown but won't duplicate intervals if we stop it first.
    // Wait, we didn't stop it in afterEach! It's running.
    // Just to be safe, let's stop and restart to force the interval to run fresh 
    // (though the existing one will fire in <15s anyway).
    stopWorker();
    startWorker();

    // Wait until still_dark_pole_ids is populated (verifier ran)
    const finalTicket = await waitForCondition(async () => {
      const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (t && t.still_dark_pole_ids && Array.isArray(t.still_dark_pole_ids) && t.still_dark_pole_ids.length > 0) return t;
      return null;
    });

    expect(finalTicket).toBeDefined();
    expect(finalTicket.state).toBe('RESOLVED'); // Still resolved!
    expect(finalTicket.still_dark_pole_ids).toContain(poleId);
  });
});
