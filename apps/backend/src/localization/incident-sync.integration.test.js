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

describe('syncIncidents Integration - escalation merges', () => {
  const P = 'syncmerge';
  const poles = (dt, n) => Array.from({ length: n }, (_, i) => `${P}-${dt}-${i + 1}`);
  const dtA = poles('a', 4);
  const dtB = poles('b', 4);
  const dtC = poles('c', 4);

  const incident = (type, affected, extra = {}) => ({
    type,
    upstream_live_pole_id: null,
    downstream_dark_pole_ids: affected,
    affected_pole_ids: affected,
    affected_count: affected.length,
    topology_source: 'AUTHORITATIVE',
    confidence: 'HIGH',
    confidence_reasons: [],
    ...extra,
  });

  const incidentsTouching = (ids) =>
    prisma.incident.findMany({ include: { ticket: true } }).then((all) =>
      all.filter((i) => i.affected_pole_ids.some((id) => ids.includes(id)))
    );

  async function cleanup() {
    const mine = await incidentsTouching([...dtA, ...dtB, ...dtC]);
    await prisma.incident.deleteMany({ where: { id: { in: mine.map((i) => i.id) } } });
  }

  afterAll(cleanup);

  it('collapses a feeder fault that was localized in pieces into one ticket, without closing the pieces', async () => {
    await cleanup();

    // The intermediate picture a slow worker used to publish while a feeder went dark DT by DT.
    await prisma.$transaction((tx) => syncIncidents([incident('DT', dtA)], 'dt-a', tx));
    await prisma.$transaction((tx) => syncIncidents([incident('DT', dtB)], 'dt-b', tx));
    await prisma.$transaction((tx) =>
      syncIncidents([incident('SPAN', dtC.slice(1), { upstream_live_pole_id: dtC[0] })], 'dt-c', tx)
    );

    // An operator already acknowledged dt-b's ticket: that progress must survive the merge.
    const [bIncident] = await incidentsTouching(dtB);
    await prisma.ticket.update({ where: { id: bIncident.ticket.id }, data: { state: 'ACKNOWLEDGED' } });

    const all = [...dtA, ...dtB, ...dtC];
    await prisma.$transaction((tx) => syncIncidents([incident('FEEDER', all)], 'dt-c', tx));

    const after = await incidentsTouching(all);
    expect(after).toHaveLength(1);
    const [feeder] = after;
    expect(feeder.type).toBe('FEEDER');
    expect(feeder.id).toBe(bIncident.id);
    expect(feeder.ticket.state).toBe('ACKNOWLEDGED');
    expect([...feeder.historical_affected_pole_ids].sort()).toEqual([...all].sort());

    // Nothing was fabricated into incident history.
    const closedForThesePoles = after.filter((i) => ['CLOSED', 'VERIFIED'].includes(i.ticket.state));
    expect(closedForThesePoles).toHaveLength(0);
  });

  it('keeps the earliest detection time on the surviving incident', async () => {
    await cleanup();
    await prisma.$transaction((tx) => syncIncidents([incident('DT', dtA)], 'dt-a', tx));
    const [first] = await incidentsTouching(dtA);
    await prisma.$transaction((tx) => syncIncidents([incident('DT', dtB)], 'dt-b', tx));

    await prisma.$transaction((tx) => syncIncidents([incident('FEEDER', [...dtA, ...dtB])], 'dt-b', tx));

    const [merged] = await incidentsTouching([...dtA, ...dtB]);
    expect(merged.first_detected_at.getTime()).toBe(first.first_detected_at.getTime());
  });

  it('opens a single ticket when one run computes overlapping incidents', async () => {
    await cleanup();
    await prisma.$transaction((tx) =>
      syncIncidents([incident('DT', dtA), incident('SPAN', dtA.slice(2), { upstream_live_pole_id: dtA[1] })], 'dt-a', tx)
    );

    const after = await incidentsTouching(dtA);
    expect(after).toHaveLength(1);
    expect(after[0].type).toBe('DT');
  });
});
