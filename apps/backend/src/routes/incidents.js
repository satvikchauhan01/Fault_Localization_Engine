/**
 * @file incidents.js — Incident Read API Routes
 *
 * Exposes GET /api/incidents and GET /api/incidents/:id for frontend use.
 */

import { prisma as defaultPrisma } from '../db.js';
import { explainIncident } from '../ai/explain.js';

export default async function incidentRoutes(fastify, opts) {
  const db = opts.prisma || defaultPrisma;

  /**
   * GET /api/incidents
   * Retrieves a list of incidents with their associated tickets.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const incidents = await db.incident.findMany({
        where: {
          ticket: {
            state: {
              notIn: ['VERIFIED', 'CLOSED']
            }
          }
        },
        include: {
          ticket: true,
        },
        orderBy: {
          first_detected_at: 'desc',
        },
      });
      return incidents;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/incidents/history
   * Returns all resolved/verified/closed incidents for the history page.
   */
  fastify.get('/history', async (request, reply) => {
    try {
      const { limit = 100, offset = 0, type, confidence } = request.query;
      const where = {
        ticket: {
          state: { in: ['VERIFIED', 'CLOSED', 'RESOLVED'] }
        }
      };
      if (type) where.type = type;
      if (confidence) where.confidence = confidence;

      const [incidents, total] = await Promise.all([
        db.incident.findMany({
          where,
          include: { ticket: true },
          orderBy: { first_detected_at: 'desc' },
          take: parseInt(limit),
          skip: parseInt(offset),
        }),
        db.incident.count({ where }),
      ]);

      return { incidents, total };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/incidents/:id
   * Retrieves a specific incident by ID, including its ticket.
   */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const incident = await db.incident.findUnique({
        where: { id },
        include: { ticket: true },
      });
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      return incident;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/incidents/:id/explain
   * Returns a minimal AI explanation of the incident.
   */
  fastify.get('/:id/explain', async (request, reply) => {
    const { id } = request.params;
    try {
      const incident = await db.incident.findUnique({
        where: { id },
        include: { ticket: true },
      });
      if (!incident) {
        return reply.status(404).send({ error: 'Incident not found' });
      }
      
      console.log('[EXPLAIN] Incident before explain:', incident);
      const explanation = await explainIncident(incident);
      return { explanation };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
