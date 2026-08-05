import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { processNextTelemetryEvent } from './ingestion-worker.js';

const prisma = new PrismaClient();

describe('Ingestion Worker Integration Tests', () => {
  let dtId, feederId;

  beforeEach(async () => {
    // Clear state
    await prisma.ticket.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.topologyEdge.deleteMany();
    await prisma.poleState.deleteMany();
    await prisma.telemetryInbox.deleteMany();
    await prisma.device.deleteMany();
    await prisma.pole.deleteMany();
    await prisma.transformer.deleteMany();
    await prisma.feeder.deleteMany();

    feederId = 'f1';
    dtId = 'dt1';

    await prisma.feeder.create({ data: { id: feederId, name: 'Feeder 1' }});
    await prisma.transformer.create({
      data: {
        id: dtId, feeder_id: feederId, lat: 0, lon: 0,
        capacity_kva: 100, households_served: 50, topology_source: 'RECORDED'
      }
    });

    // P1 -> P2 -> P3 (all monitored)
    await prisma.pole.createMany({
      data: [
        { id: 'p1', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
        { id: 'p2', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
        { id: 'p3', dt_id: dtId, feeder_id: feederId, lat: 0, lon: 0 },
      ]
    });

    const baseDev = { fw_version: '1.3.0', first_seen: new Date(), last_seen: new Date() };
    await prisma.device.createMany({
      data: [
        { id: 'd1', pole_id: 'p1', ...baseDev },
        { id: 'd2', pole_id: 'p2', ...baseDev },
        { id: 'd3', pole_id: 'p3', ...baseDev },
      ]
    });

    await prisma.topologyEdge.createMany({
      data: [
        { parent_pole_id: 'p1', child_pole_id: 'p2', source: 'AUTHORITATIVE' },
        { parent_pole_id: 'p2', child_pole_id: 'p3', source: 'AUTHORITATIVE' },
      ]
    });
    
    // Clear sim crash flag
    delete process.env.SIMULATE_CRASH;
  });

  afterEach(() => {
    delete process.env.SIMULATE_CRASH;
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.topologyEdge.deleteMany();
    await prisma.poleState.deleteMany();
    await prisma.telemetryInbox.deleteMany();
    await prisma.device.deleteMany();
    await prisma.pole.deleteMany();
    await prisma.transformer.deleteMany();
    await prisma.feeder.deleteMany();
  });

  async function enqueue(events) {
    await prisma.telemetryInbox.createMany({
      data: events.map(e => ({
        device_id: e.device_id,
        pole_id: e.pole_id,
        event: e.event,
        energized: e.energized,
        seq: e.seq,
        device_ts: e.device_ts,
        fw: e.fw,
        server_received_at: e.server_received_at,
        status: e.status || 'PENDING'
      }))
    });
  }

  it('handles duplicate telemetry idempotently', async () => {
    const older = new Date(Date.now() - 100000); // > 90s for immediate debounce
    const eventD3 = {
      device_id: 'd3', pole_id: 'p3', event: 'power_lost', energized: false, seq: 9,
      device_ts: older, fw: '1.3.0', server_received_at: older, status: 'PENDING'
    };
    const eventD2 = {
      device_id: 'd2', pole_id: 'p2', event: 'power_lost', energized: false, seq: 10,
      device_ts: older, fw: '1.3.0', server_received_at: older, status: 'PENDING'
    };

    // Insert d3 once, and d2 twice
    await enqueue([eventD3, eventD2, { ...eventD2 }]);

    // Process all 3 events
    let processedCount = 0;
    while (await processNextTelemetryEvent()) {
      processedCount++;
    }
    expect(processedCount).toBe(3);

    const p2 = await prisma.poleState.findUnique({ where: { pole_id: 'p2' }});
    expect(p2.last_event_seq).toBe(10);
    expect(p2.status).toBe('CONFIRMED_DARK');
    
    // Even though d2 was processed twice, only 1 incident should exist (P1 -> P2)
    const activeIncidents = await prisma.incident.findMany({ where: { ticket: { state: 'DETECTED' } }});
    expect(activeIncidents).toHaveLength(1);
    expect(activeIncidents[0].upstream_live_pole_id).toBe('p1');
    // It should include p2 and p3 in affected poles
    expect(activeIncidents[0].affected_count).toBe(2);
  });

  it('ignores out-of-order stale events (seq rule)', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 10000);
    const oldest = new Date(now.getTime() - 100000);

    // Event seq 15 arrives first
    await enqueue([{
      device_id: 'd3', pole_id: 'p3', event: 'heartbeat', energized: true, seq: 15,
      device_ts: older, fw: '1.3.0', server_received_at: older
    }]);
    await processNextTelemetryEvent();

    // Event seq 12 arrives later
    await enqueue([{
      device_id: 'd3', pole_id: 'p3', event: 'power_lost', energized: false, seq: 12,
      device_ts: oldest, fw: '1.3.0', server_received_at: oldest
    }]);
    await processNextTelemetryEvent();

    // The pole should remain LIVE because seq 12 was discarded
    const state = await prisma.poleState.findUnique({ where: { pole_id: 'p3' }});
    expect(state.status).toBe('LIVE');
    
    const incidents = await prisma.incident.findMany();
    expect(incidents).toHaveLength(0); // No incident created
  });

  it('crash recovery mid-transaction rolls back safely and prevents duplicates', async () => {
    const older = new Date(Date.now() - 100000); // > 90s for immediate debounce
    await enqueue([
      {
        device_id: 'd3', pole_id: 'p3', event: 'power_lost', energized: false, seq: 19,
        device_ts: older, fw: '1.3.0', server_received_at: older
      },
      {
        device_id: 'd2', pole_id: 'p2', event: 'power_lost', energized: false, seq: 20,
        device_ts: older, fw: '1.3.0', server_received_at: older
      }
    ]);

    // process d3 successfully first
    await processNextTelemetryEvent();

    // Now, simulate a crash on d2's processing
    process.env.SIMULATE_CRASH = '1';

    // 1st attempt for d2: crashes
    await expect(processNextTelemetryEvent()).rejects.toThrow('Simulated Crash Mid-Transaction');

    // Verify DB was rolled back: inbox row for d2 should still be PENDING
    const pendingCount = await prisma.telemetryInbox.count({ where: { status: 'PENDING' }});
    expect(pendingCount).toBe(1);

    // Recover from crash
    delete process.env.SIMULATE_CRASH;

    // 2nd attempt: succeeds
    await processNextTelemetryEvent();

    const pendingCountAfter = await prisma.telemetryInbox.count({ where: { status: 'PENDING' }});
    expect(pendingCountAfter).toBe(0);

    const activeIncidents = await prisma.incident.findMany({ where: { ticket: { state: 'DETECTED' } }});
    // Only P1->P2 fault should exist (no duplicate incidents from crash recovery)
    expect(activeIncidents).toHaveLength(1);
    expect(activeIncidents[0].upstream_live_pole_id).toBe('p1');
  });
  it('processes 6-hour stale retry telemetry correctly', async () => {
    // 6 hours ago
    const staleTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
    
    // Enqueue a power_lost event that occurred 6 hours ago
    await enqueue([{
      device_id: 'd3', pole_id: 'p3', event: 'power_lost', energized: false, seq: 25,
      device_ts: staleTime, fw: '1.3.0', server_received_at: new Date()
    }]);

    await processNextTelemetryEvent();

    const p3 = await prisma.poleState.findUnique({ where: { pole_id: 'p3' }});
    // Because device_ts (or candidate_dark_since) is old? Wait, candidate_dark_since is set to server_received_at!
    // Actually, processEvent uses event.server_received_at for candidate_dark_since.
    // If the event arrived NOW, the debounce starts NOW.
    // So the state should be LIVE (pending debounce)!
    // Let's check the rules: Rule 2 uses server_received_at.
    expect(p3.status).toBe('LIVE');
    expect(p3.evidence_summary).toBe('power_lost');
  });

  it('does not falsely timeout when processing telemetry from a stale device', async () => {
    const staleTime = new Date(Date.now() - 7 * 60 * 60 * 1000);
    // Artificially age the device's last_seen
    await prisma.device.update({
      where: { id: 'd3' },
      data: { last_seen: staleTime }
    });

    // Enqueue a boot event. The device had a stale last_seen, but the incoming
    // telemetry itself proves it is currently reachable.
    await enqueue([{
      device_id: 'd3', pole_id: 'p3', event: 'boot', energized: true, seq: 1,
      device_ts: new Date(), fw: '1.3.0', server_received_at: new Date()
    }]);

    await processNextTelemetryEvent();

    const p3 = await prisma.poleState.findUnique({ where: { pole_id: 'p3' }});
    expect(p3.status).toBe('LIVE');
    expect(p3.evidence_type).toBe('boot');
  });

});
