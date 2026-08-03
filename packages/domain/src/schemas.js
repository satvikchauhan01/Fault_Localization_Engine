import { z } from 'zod';

/**
 * Enums & Literals
 */
export const TopologySourceEnum = z.enum(['AUTHORITATIVE', 'INFERRED']);

export const TelemetryEventTypeEnum = z.enum([
  'heartbeat',
  'power_lost',
  'power_restored',
  'boot',
]);

export const PoleStatusEnum = z.enum([
  'LIVE',
  'CONFIRMED_DARK',
  'STALE',
  'OFFLINE_UNKNOWN',
  'SENSOR_SUSPECT',
]);

export const ScheduledOutageScopeEnum = z.enum(['DT', 'FEEDER', 'SPAN']);

export const IncidentTypeEnum = z.enum(['SPAN', 'DT', 'FEEDER', 'RANGE']);

export const ConfidenceLevelEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const TicketStateEnum = z.enum([
  'DETECTED',
  'ACKNOWLEDGED',
  'CREW_ASSIGNED',
  'RESOLVED',
  'VERIFIED',
  'CLOSED',
]);

export const SimulatorFaultTypeEnum = z.enum(['SPAN', 'DT', 'FEEDER']);

/**
 * Entity Schemas matching Section F
 */

export const PoleSchema = z.object({
  id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  dt_id: z.string().min(1),
  feeder_id: z.string().min(1),
  seq_on_line: z.number().int().positive().optional(),
  parent_pole_id: z.string().nullable().optional(),
  device_id: z.string().nullable().optional(),
  ward: z.string().optional(),
  pincode: z.string().nullable().optional(),
});

export const DeviceSchema = z.object({
  id: z.string().min(1),
  pole_id: z.string().nullable().optional(),
  fw_version: z.string().min(1),
  first_seen: z.string().datetime(),
  last_seen: z.string().datetime(),
});

export const TransformerSchema = z.object({
  id: z.string().min(1),
  feeder_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  capacity_kva: z.number().positive(),
  households_served: z.number().int().nonnegative(),
  topology_source: TopologySourceEnum,
});

export const FeederSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});

export const TelemetryEventSchema = z.object({
  device_id: z.string().min(1),
  pole_id: z.string().min(1),
  event: TelemetryEventTypeEnum,
  energized: z.boolean(),
  device_ts: z.string().datetime(),
  seq: z.number().int().nonnegative(),
  battery_mv: z.number().optional(),
  rssi: z.number().optional(),
  fw: z.string().min(1),
  server_received_at: z.string().datetime(),
});

export const PoleStateSchema = z.object({
  pole_id: z.string().min(1),
  status: PoleStatusEnum,
  last_confirmed_at: z.string().datetime(),
  last_event_seq: z.number().int().nonnegative(),
  evidence_summary: z.string(),
});

export const TopologyEdgeSchema = z.object({
  parent_pole_id: z.string().min(1),
  child_pole_id: z.string().min(1),
  source: TopologySourceEnum,
  weight: z.number().nonnegative().optional(),
  ambiguous: z.boolean(),
});

export const ScheduledOutageSchema = z.object({
  id: z.string().min(1),
  scope: ScheduledOutageScopeEnum,
  target_id: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  reason: z.string(),
  fetched_at: z.string().datetime(),
});

export const IncidentBoundarySchema = z.object({
  upstream_live_pole_id: z.string().nullable(),
  downstream_dark_pole_ids: z.array(z.string()),
});

export const IncidentSchema = z.object({
  id: z.string().min(1),
  type: IncidentTypeEnum,
  boundary: IncidentBoundarySchema,
  affected_pole_ids: z.array(z.string()),
  affected_count: z.number().int().nonnegative(),
  topology_source: TopologySourceEnum,
  confidence: ConfidenceLevelEnum,
  confidence_reasons: z.array(z.string()),
  scheduled_outage_overlap: z.boolean(),
  first_detected_at: z.string().datetime(),
});

export const TicketSchema = z.object({
  id: z.string().min(1),
  incident_id: z.string().min(1),
  state: TicketStateEnum,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable().optional(),
  verified_at: z.string().datetime().nullable().optional(),
});

export const SimulatorFaultSchema = z.object({
  id: z.string().min(1),
  type: SimulatorFaultTypeEnum,
  target: z.string().min(1),
  injected_at: z.string().datetime(),
  repaired_at: z.string().datetime().nullable().optional(),
});
