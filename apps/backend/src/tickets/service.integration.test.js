import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../db.js';
import { getTicket, listTickets, transitionTicket } from './service.js';
import { buildApp } from '../app.js';

describe('Ticket Service & API Integration', () => {
  let app;
  let testIncidentId;
  let testTicketId;

  beforeEach(async () => {
    app = buildApp();
    await prisma.ticket.deleteMany();
    await prisma.incident.deleteMany();

    const incident = await prisma.incident.create({
      data: {
        id: 'inc-1',
        type: 'DT',
        affected_count: 5,
        downstream_dark_pole_ids: [],
        affected_pole_ids: [],
        historical_affected_pole_ids: [],
        topology_source: 'AUTHORITATIVE',
        confidence: 'HIGH',
        confidence_reasons: []
      }
    });
    testIncidentId = incident.id;

    const ticket = await prisma.ticket.create({
      data: {
        id: 'tick-1',
        incident_id: testIncidentId,
        state: 'DETECTED'
      }
    });
    testTicketId = ticket.id;
  });

  describe('Service Logic', () => {
    it('allows valid state transitions and sets timestamps', async () => {
      let t = await transitionTicket(testTicketId, 'ACKNOWLEDGED');
      expect(t.state).toBe('ACKNOWLEDGED');

      t = await transitionTicket(testTicketId, 'CREW_ASSIGNED');
      expect(t.state).toBe('CREW_ASSIGNED');

      t = await transitionTicket(testTicketId, 'RESOLVED');
      expect(t.state).toBe('RESOLVED');
      expect(t.resolved_at).toBeTruthy();

      t = await transitionTicket(testTicketId, 'VERIFIED', { isSystem: true });
      expect(t.state).toBe('VERIFIED');
      expect(t.verified_at).toBeTruthy();

      t = await transitionTicket(testTicketId, 'CLOSED');
      expect(t.state).toBe('CLOSED');
    });

    it('rejects invalid state transitions', async () => {
      await expect(transitionTicket(testTicketId, 'CLOSED')).rejects.toThrow(/Illegal state transition/);
      await expect(transitionTicket(testTicketId, 'RESOLVED')).rejects.toThrow(/Illegal state transition/);
    });

    it('rejects VERIFIED transition if not initiated by system', async () => {
      await transitionTicket(testTicketId, 'ACKNOWLEDGED');
      await transitionTicket(testTicketId, 'CREW_ASSIGNED');
      await transitionTicket(testTicketId, 'RESOLVED');
      
      await expect(transitionTicket(testTicketId, 'VERIFIED')).rejects.toThrow(/State VERIFIED can only be set by the system/);
    });
  });

  describe('API Routes', () => {
    it('GET /api/tickets returns the list of tickets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/tickets'
      });
      expect(response.statusCode).toBe(200);
      const tickets = response.json();
      expect(tickets).toHaveLength(1);
      expect(tickets[0].id).toBe(testTicketId);
    });

    it('POST /api/tickets/:id/transition transitions a ticket state successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/tickets/${testTicketId}/transition`,
        payload: { state: 'ACKNOWLEDGED' }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe('ACKNOWLEDGED');
    });

    it('POST /api/tickets/:id/transition rejects invalid transitions', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/tickets/${testTicketId}/transition`,
        payload: { state: 'CLOSED' }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/Illegal state transition/);
    });

    it('POST /api/tickets/:id/transition rejects manual transition to VERIFIED', async () => {
      await transitionTicket(testTicketId, 'ACKNOWLEDGED');
      await transitionTicket(testTicketId, 'CREW_ASSIGNED');
      await transitionTicket(testTicketId, 'RESOLVED');

      const response = await app.inject({
        method: 'POST',
        url: `/api/tickets/${testTicketId}/transition`,
        payload: { state: 'VERIFIED' }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/State VERIFIED can only be set by the system/);
    });
  });
});
