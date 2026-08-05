import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

let app;

import crypto from 'crypto';

beforeAll(async () => {
  app = buildApp({ prisma });
  await app.ready();

  // Clean and insert dummy data for shape testing
  await prisma.ticket.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.poleState.deleteMany();
  await prisma.topologyEdge.deleteMany();
  await prisma.pole.deleteMany();
  await prisma.transformer.deleteMany();
  await prisma.feeder.deleteMany();

  const feederId = crypto.randomUUID();
  const dtId = crypto.randomUUID();
  const pole1Id = crypto.randomUUID();
  const pole2Id = crypto.randomUUID();
  const incidentId = crypto.randomUUID();

  await prisma.feeder.create({
    data: { id: feederId, name: 'Test Feeder' }
  });

  await prisma.transformer.create({
    data: { id: dtId, feeder_id: feederId, lat: 0, lon: 0, capacity_kva: 100, households_served: 10, topology_source: 'RECORDED' }
  });

  await prisma.pole.createMany({
    data: [
      { id: pole1Id, feeder_id: feederId, dt_id: dtId, lat: 0, lon: 0, seq_on_line: 1 },
      { id: pole2Id, feeder_id: feederId, dt_id: dtId, lat: 0, lon: 0, seq_on_line: 2, parent_pole_id: pole1Id }
    ]
  });

  await prisma.poleState.create({
    data: { pole_id: pole1Id, status: 'LIVE', last_confirmed_at: new Date(), last_event_seq: 1, evidence_summary: 'Test', evidence_type: 'Test' }
  });

  await prisma.topologyEdge.create({
    data: { parent_pole_id: pole1Id, child_pole_id: pole2Id, source: 'AUTHORITATIVE', weight: 1, ambiguous: false }
  });

  await prisma.incident.create({
    data: {
      id: incidentId, type: 'SPAN', affected_count: 1, downstream_dark_pole_ids: [],
      affected_pole_ids: [], historical_affected_pole_ids: [], topology_source: 'AUTHORITATIVE',
      confidence: 'HIGH', confidence_reasons: []
    }
  });

  await prisma.ticket.create({
    data: { id: crypto.randomUUID(), incident_id: incidentId, state: 'DETECTED' }
  });
});

afterAll(async () => {
  await app.close();
  await prisma.ticket.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.poleState.deleteMany();
  await prisma.topologyEdge.deleteMany();
  await prisma.pole.deleteMany();
  await prisma.transformer.deleteMany();
  await prisma.feeder.deleteMany();
});

describe('API Contract Tests (Step 26)', () => {
  describe('GET /api/incidents', () => {
    it('returns a list of incidents with ticket information', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents'
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      
      if (data.length > 0) {
        const incident = data[0];
        expect(incident).toHaveProperty('id');
        expect(incident).toHaveProperty('type');
        expect(incident).toHaveProperty('affected_count');
        expect(incident).toHaveProperty('topology_source');
        expect(incident).toHaveProperty('ticket');
        
        // Even if ticket is null, it should be a key if included.
        // Wait, prisma include ticket might return null or object.
        if (incident.ticket) {
          expect(incident.ticket).toHaveProperty('state');
          expect(incident.ticket).toHaveProperty('id');
        }
      }
    });
  });

  describe('GET /api/map/data', () => {
    it('returns feeders, transformers, poles, and topology_edges', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/map/data'
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      
      expect(data).toHaveProperty('feeders');
      expect(Array.isArray(data.feeders)).toBe(true);

      expect(data).toHaveProperty('transformers');
      expect(Array.isArray(data.transformers)).toBe(true);

      expect(data).toHaveProperty('poles');
      expect(Array.isArray(data.poles)).toBe(true);

      expect(data).toHaveProperty('topology_edges');
      expect(Array.isArray(data.topology_edges)).toBe(true);

      if (data.poles.length > 0) {
        const pole = data.poles[0];
        expect(pole).toHaveProperty('id');
        expect(pole).toHaveProperty('lat');
        expect(pole).toHaveProperty('lon');
        expect(pole).toHaveProperty('state'); // The mapped state from PoleState
      }
    });
  });
});
