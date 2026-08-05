import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../db.js';
import { syncIncidents } from './incident-sync.js';

describe('syncIncidents Integration - RANGE Faults', () => {

  afterAll(async () => {
    // Clean up
    await prisma.ticket.deleteMany({ where: { incident: { type: 'RANGE' } } });
    await prisma.incident.deleteMany({ where: { type: 'RANGE' } });
  });

  it('successfully persists a RANGE incident with affected_pole_ids', async () => {
    // Generate a test DT ID
    const dtId = 'dt-range-test-1';

    const rangeIncident = {
      type: 'RANGE',
      upstream_live_pole_id: 'pole-live-1',
      downstream_dark_pole_ids: ['pole-dark-1'],
      unmonitored_pole_ids: ['pole-gap-1'],
      affected_pole_ids: ['pole-gap-1', 'pole-dark-1'], // The critical field we added
      affected_count: 2, // Required by DB schema
      gap_pole_count: 2,
      low_confidence_by_size: false,
      topology_source: 'AUTHORITATIVE',
      ambiguous: false,
      confidence: 'MEDIUM', // Added by orchestrator
      confidence_reasons: []
    };

    // Use a transaction just like the worker does
    await prisma.$transaction(async (tx) => {
      await expect(
        syncIncidents([rangeIncident], dtId, tx)
      ).resolves.not.toThrow();
    });

    const savedIncident = await prisma.incident.findFirst({
      where: { type: 'RANGE' },
      include: { ticket: true }
    });

    expect(savedIncident).toBeDefined();
    expect(savedIncident.type).toBe('RANGE');
    expect(savedIncident.affected_pole_ids).toEqual(['pole-gap-1', 'pole-dark-1']);
    expect(savedIncident.ticket).toBeDefined();
    
    // Clean up inside test for repeatability if needed, but afterAll handles it
    if (savedIncident) {
      if (savedIncident.ticket) {
        await prisma.ticket.delete({ where: { id: savedIncident.ticket.id }});
      }
      await prisma.incident.delete({ where: { id: savedIncident.id }});
    }
  });
});
