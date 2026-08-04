import { describe, it, expect } from 'vitest';
import {
  PoleSchema,
  DeviceSchema,
  TransformerSchema,
  FeederSchema,
  TelemetryEventSchema,
  PoleStateSchema,
  TopologyEdgeSchema,
  ScheduledOutageSchema,
  IncidentSchema,
  TicketSchema,
  SimulatorFaultSchema,
} from './schemas.js';

describe('Domain Zod Schemas Validation', () => {
  const now = new Date().toISOString();

  it('validates PoleSchema correctly', () => {
    const valid = {
      id: 'pole-101',
      lat: 12.9716,
      lon: 77.5946,
      dt_id: 'dt-1',
      feeder_id: 'feeder-1',
      seq_on_line: 1,
      parent_pole_id: null,
      device_id: 'dev-1',
      ward: 'Ward 4',
      pincode: '560001',
    };
    const invalid = { id: 'pole-101', lat: 200, lon: 77.5946 }; // Invalid latitude

    expect(PoleSchema.safeParse(valid).success).toBe(true);
    expect(PoleSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates DeviceSchema correctly', () => {
    const valid = {
      id: 'dev-1',
      pole_id: 'pole-101',
      fw_version: '1.3.0',
      first_seen: now,
      last_seen: now,
    };
    const invalid = { id: 'dev-1', fw_version: '1.3.0', first_seen: 'not-a-date' };

    expect(DeviceSchema.safeParse(valid).success).toBe(true);
    expect(DeviceSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates TransformerSchema correctly', () => {
    const valid = {
      id: 'dt-1',
      feeder_id: 'feeder-1',
      lat: 12.9716,
      lon: 77.5946,
      capacity_kva: 100,
      households_served: 45,
      topology_source: 'AUTHORITATIVE',
    };
    const invalid = { ...valid, topology_source: 'UNKNOWN_SOURCE' };

    expect(TransformerSchema.safeParse(valid).success).toBe(true);
    expect(TransformerSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates FeederSchema correctly', () => {
    const valid = { id: 'feeder-1', name: 'Feeder A' };
    const invalid = { id: '' }; // id min(1) constraint

    expect(FeederSchema.safeParse(valid).success).toBe(true);
    expect(FeederSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates TelemetryEventSchema correctly', () => {
    const valid = {
      device_id: 'dev-1',
      pole_id: 'pole-101',
      event: 'power_lost',
      energized: false,
      device_ts: now,
      seq: 42,
      battery_mv: 3300,
      rssi: -75,
      fw: '1.3.0',
      server_received_at: now,
    };
    const invalid = { ...valid, event: 'power_fluctuated' };

    expect(TelemetryEventSchema.safeParse(valid).success).toBe(true);
    expect(TelemetryEventSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates PoleStateSchema correctly', () => {
    const valid = {
      pole_id: 'pole-101',
      status: 'CONFIRMED_DARK',
      last_confirmed_at: now,
      last_event_seq: 42,
      evidence_summary: '2 consecutive heartbeats missed',
      evidence_type: 'timeout_fw13',
    };
    const invalid = { ...valid, status: 'BROKEN' };

    expect(PoleStateSchema.safeParse(valid).success).toBe(true);
    expect(PoleStateSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates TopologyEdgeSchema correctly', () => {
    const valid = {
      parent_pole_id: 'pole-101',
      child_pole_id: 'pole-102',
      source: 'INFERRED',
      weight: 15.5,
      ambiguous: false,
    };
    const invalid = { ...valid, source: 'GUESSED' };

    expect(TopologyEdgeSchema.safeParse(valid).success).toBe(true);
    expect(TopologyEdgeSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates ScheduledOutageSchema correctly', () => {
    const valid = {
      id: 'sched-1',
      scope: 'DT',
      target_id: 'dt-1',
      start: now,
      end: now,
      reason: 'Transformer maintenance',
      fetched_at: now,
    };
    const invalid = { ...valid, scope: 'CITY' };

    expect(ScheduledOutageSchema.safeParse(valid).success).toBe(true);
    expect(ScheduledOutageSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates IncidentSchema correctly', () => {
    const valid = {
      id: 'inc-1',
      type: 'SPAN',
      boundary: {
        upstream_live_pole_id: 'pole-101',
        downstream_dark_pole_ids: ['pole-102'],
      },
      affected_pole_ids: ['pole-102', 'pole-103'],
      affected_count: 2,
      topology_source: 'AUTHORITATIVE',
      confidence: 'HIGH',
      confidence_reasons: ['Directly monitored boundary poles', 'Authoritative topology'],
      scheduled_outage_overlap: false,
      first_detected_at: now,
    };
    const invalid = { ...valid, confidence: 'SUPER_HIGH' };

    expect(IncidentSchema.safeParse(valid).success).toBe(true);
    expect(IncidentSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates TicketSchema correctly', () => {
    const valid = {
      id: 'tkt-1',
      incident_id: 'inc-1',
      state: 'DETECTED',
      created_at: now,
      updated_at: now,
      resolved_at: null,
      verified_at: null,
    };
    const invalid = { ...valid, state: 'FIXED' };

    expect(TicketSchema.safeParse(valid).success).toBe(true);
    expect(TicketSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates SimulatorFaultSchema correctly', () => {
    const valid = {
      id: 'sim-fault-1',
      type: 'SPAN',
      target: 'pole-101',
      injected_at: now,
      repaired_at: null,
    };
    const invalid = { ...valid, type: 'TRANSFORMER' };

    expect(SimulatorFaultSchema.safeParse(valid).success).toBe(true);
    expect(SimulatorFaultSchema.safeParse(invalid).success).toBe(false);
  });
});
