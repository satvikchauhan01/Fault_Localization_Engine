/**
 * @file incidents.js — Incident Read API Routes
 *
 * Exposes GET /api/incidents and GET /api/incidents/:id for frontend use.
 */

import { prisma as defaultPrisma } from '../db.js';

export default async function incidentRoutes(fastify, opts) {
  const db = opts.prisma || defaultPrisma;

  /**
   * GET /api/incidents
   * Retrieves a list of incidents with their associated tickets.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const incidents = await db.incident.findMany({
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
}
