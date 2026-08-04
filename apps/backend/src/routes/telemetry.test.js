import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';

describe('Telemetry Ingestion Endpoint (POST /telemetry)', () => {
  let app;
  let mockPrisma;
  let createdRecords;

  beforeEach(() => {
    createdRecords = [];
    mockPrisma = {
      telemetryInbox: {
        create: vi.fn(async ({ data }) => {
          const record = {
            id: `inbox-uuid-${createdRecords.length + 1}`,
            ...data,
            processed_at: null,
          };
          createdRecords.push(record);
          return record;
        }),
      },
    };

    app = buildApp({
      prisma: mockPrisma,
      logger: false,
    });
  });

  it('GET /health returns 200 OK', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'kspdb-backend' });
  });

  it('POST /telemetry with valid payload returns 202 Accepted and stores in telemetry_inbox', async () => {
    const payload = {
      device_id: 'dev-001',
      pole_id: 'pole-101',
      event: 'power_lost',
      energized: false,
      device_ts: '2026-08-04T10:00:00.000Z',
      seq: 101,
      battery_mv: 3300,
      rssi: -75,
      fw: '1.3.0',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/telemetry',
      payload,
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('accepted');
    expect(body.id).toBeDefined();

    expect(mockPrisma.telemetryInbox.create).toHaveBeenCalledOnce();
    expect(createdRecords).toHaveLength(1);
    expect(createdRecords[0].device_id).toBe('dev-001');
    expect(createdRecords[0].pole_id).toBe('pole-101');
    expect(createdRecords[0].event).toBe('power_lost');
    expect(createdRecords[0].energized).toBe(false);
    expect(createdRecords[0].status).toBe('PENDING');
  });

  it('POST /telemetry with explicit server_received_at handles datetime correctly', async () => {
    const payload = {
      device_id: 'dev-002',
      pole_id: 'pole-102',
      event: 'heartbeat',
      energized: true,
      device_ts: '2026-08-04T10:01:00.000Z',
      seq: 102,
      fw: '1.3.0',
      server_received_at: '2026-08-04T10:01:02.000Z',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/telemetry',
      payload,
    });

    expect(res.statusCode).toBe(202);
    expect(createdRecords[0].server_received_at).toEqual(new Date('2026-08-04T10:01:02.000Z'));
  });

  it('POST /telemetry with missing required fields returns 400 Bad Request', async () => {
    const payload = {
      pole_id: 'pole-101',
      event: 'power_lost',
      // missing device_id, device_ts, seq, etc.
    };

    const res = await app.inject({
      method: 'POST',
      url: '/telemetry',
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Invalid telemetry payload');
    expect(body.details).toBeDefined();
    expect(mockPrisma.telemetryInbox.create).not.toHaveBeenCalled();
  });

  it('POST /telemetry with invalid event enum returns 400 Bad Request', async () => {
    const payload = {
      device_id: 'dev-001',
      pole_id: 'pole-101',
      event: 'invalid_event_type',
      energized: false,
      device_ts: '2026-08-04T10:00:00.000Z',
      seq: 1,
      fw: '1.3.0',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/telemetry',
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(mockPrisma.telemetryInbox.create).not.toHaveBeenCalled();
  });

  it('POST /telemetry handles DB failure gracefully with 500 status', async () => {
    mockPrisma.telemetryInbox.create.mockRejectedValueOnce(new Error('DB Connection Failed'));

    const payload = {
      device_id: 'dev-001',
      pole_id: 'pole-101',
      event: 'power_restored',
      energized: true,
      device_ts: '2026-08-04T10:00:00.000Z',
      seq: 103,
      fw: '1.3.0',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/telemetry',
      payload,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Internal server error');
  });
});
