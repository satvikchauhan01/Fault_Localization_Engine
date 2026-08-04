import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { processNextTelemetryEvent } from '../worker/ingestion-worker.js';
import { fetchAndCacheScheduledOutages, checkScheduledOutageOverlap } from './adapter.js';

const prisma = new PrismaClient();

describe('Scheduled Outage Adapter & Overlap Integration Tests', () => {
  let dtId, feederId;

  beforeEach(async () => {
    // Clear database tables in order
    await prisma.ticket.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.scheduledOutage.deleteMany();
    await prisma.topologyEdge.deleteMany();
    await prisma.poleState.deleteMany();
    await prisma.telemetryInbox.deleteMany();
    await prisma.device.deleteMany();
    await prisma.pole.deleteMany();
    await prisma.transformer.deleteMany();
    await prisma.feeder.deleteMany();

    feederId = 'f_so';
    dtId = 'dt_so';

    await prisma.feeder.create({ data: { id: feederId, name: 'Feeder Outage Test' } });
    await prisma.transformer.create({
      data: {
        id: dtId,
        feeder_id: feederId,
        lat: 0,
        lon: 0,
        capacity_kva: 100,
        households_served: 50,
        topology_source: 'RECORDED',
      },
    });

    // Setup topology: p1_so -> p2_so -> p3_so
    await prisma.pole.createMany({
      data: [
        { id: 'p1_so', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
        { id: 'p2_so', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
        { id: 'p3_so', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
      ],
    });

    const baseDev = { fw_version: '1.3.0', first_seen: new Date(), last_seen: new Date() };
    await prisma.device.createMany({
      data: [
        { id: 'd1_so', pole_id: 'p1_so', ...baseDev },
        { id: 'd2_so', pole_id: 'p2_so', ...baseDev },
        { id: 'd3_so', pole_id: 'p3_so', ...baseDev },
      ],
    });

    await prisma.topologyEdge.createMany({
      data: [
        { parent_pole_id: 'p1_so', child_pole_id: 'p2_so', source: 'AUTHORITATIVE' },
        { parent_pole_id: 'p2_so', child_pole_id: 'p3_so', source: 'AUTHORITATIVE' },
      ],
    });
  });

  async function enqueue(events) {
    await prisma.telemetryInbox.createMany({
      data: events.map((e) => ({
        device_id: e.device_id,
        pole_id: e.pole_id,
        event: e.event,
        energized: e.energized,
        seq: e.seq,
        device_ts: e.device_ts,
        fw: e.fw,
        server_received_at: e.server_received_at,
        status: e.status || 'PENDING',
      })),
    });
  }

  it('fetches and caches scheduled outages locally', async () => {
    const outages = [
      {
        id: 'so-1',
        scope: 'DT',
        target_id: dtId,
        start: new Date(Date.now() - 3600_000).toISOString(),
        end: new Date(Date.now() + 3600_000).toISOString(),
        reason: 'Transformer maintenance',
      },
    ];

    const cachedCount = await fetchAndCacheScheduledOutages(outages, prisma);
    expect(cachedCount).toBe(1);

    const stored = await prisma.scheduledOutage.findUnique({ where: { id: 'so-1' } });
    expect(stored).not.toBeNull();
    expect(stored.scope).toBe('DT');
    expect(stored.target_id).toBe(dtId);
    expect(stored.reason).toBe('Transformer maintenance');
  });

  it('Matrix Row 13: Scheduled outage overlap tagged, confidence downgraded to MEDIUM, ticket STILL created', async () => {
    const now = new Date();
    const outageStart = new Date(now.getTime() - 1800_000); // 30 min ago
    const outageEnd = new Date(now.getTime() + 1800_000); // 30 min from now

    // Add scheduled outage covering DT
    await prisma.scheduledOutage.create({
      data: {
        id: 'so-row13',
        scope: 'DT',
        target_id: dtId,
        start: outageStart,
        end: outageEnd,
        reason: 'Planned maintenance',
      },
    });

    const older = new Date(now.getTime() - 100_000); // > 90s for immediate debounce
    await enqueue([
      {
        device_id: 'd3_so', pole_id: 'p3_so', event: 'power_lost', energized: false, seq: 1,
        device_ts: older, fw: '1.3.0', server_received_at: older
      },
      {
        device_id: 'd2_so', pole_id: 'p2_so', event: 'power_lost', energized: false, seq: 2,
        device_ts: older, fw: '1.3.0', server_received_at: older
      },
    ]);

    // Process both telemetry events
    while (await processNextTelemetryEvent()) {}

    // Verify incident was created and tagged with scheduled_outage_overlap = true
    const incidents = await prisma.incident.findMany({
      include: { ticket: true },
    });

    expect(incidents).toHaveLength(1);
    const incident = incidents[0];

    expect(incident.scheduled_outage_overlap).toBe(true);
    expect(incident.confidence).toBe('MEDIUM');
    expect(incident.confidence_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCHEDULED_OUTAGE_OVERLAP' }),
      ])
    );

    // Assert ticket is STILL created and in DETECTED state (never suppressed)
    expect(incident.ticket).not.toBeNull();
    expect(incident.ticket.state).toBe('DETECTED');
  });

  it('Matrix Row 14: Overrun buffer / "cancelled but not updated" scenario tags overlap and creates ticket', async () => {
    const now = new Date();
    // Outage ended 25 minutes ago (within the 40-minute overrun buffer)
    const outageStart = new Date(now.getTime() - 7200_000); // 2 hrs ago
    const outageEnd = new Date(now.getTime() - 25 * 60_000); // 25 min ago

    await prisma.scheduledOutage.create({
      data: {
        id: 'so-row14',
        scope: 'DT',
        target_id: dtId,
        start: outageStart,
        end: outageEnd,
        reason: 'Overrunning cable replacement',
      },
    });

    const older = new Date(now.getTime() - 100_000);
    await enqueue([
      {
        device_id: 'd3_so', pole_id: 'p3_so', event: 'power_lost', energized: false, seq: 10,
        device_ts: older, fw: '1.3.0', server_received_at: older
      },
      {
        device_id: 'd2_so', pole_id: 'p2_so', event: 'power_lost', energized: false, seq: 11,
        device_ts: older, fw: '1.3.0', server_received_at: older
      },
    ]);

    while (await processNextTelemetryEvent()) {}

    const incidents = await prisma.incident.findMany({
      include: { ticket: true },
    });

    expect(incidents).toHaveLength(1);
    const incident = incidents[0];

    // Outage ended 25 min ago, but within 40 min buffer -> overlap tagged
    expect(incident.scheduled_outage_overlap).toBe(true);
    expect(incident.confidence).toBe('MEDIUM');

    // Ticket is STILL created
    expect(incident.ticket).not.toBeNull();
    expect(incident.ticket.state).toBe('DETECTED');
  });

  it('returns false when fault occurs after overrun buffer expires', async () => {
    const now = new Date();
    // Outage ended 50 minutes ago (beyond the 40-minute overrun buffer)
    const outageStart = new Date(now.getTime() - 7200_000);
    const outageEnd = new Date(now.getTime() - 50 * 60_000);

    await prisma.scheduledOutage.create({
      data: {
        id: 'so-expired',
        scope: 'DT',
        target_id: dtId,
        start: outageStart,
        end: outageEnd,
        reason: 'Old maintenance',
      },
    });

    const hasOverlap = await checkScheduledOutageOverlap({
      dtId,
      feederId,
      affectedPoleIds: ['p2_so', 'p3_so'],
      incidentTime: now,
    }, prisma);

    expect(hasOverlap).toBe(false);
  });
});
