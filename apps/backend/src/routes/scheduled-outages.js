/**
 * @file scheduled-outages.js — Scheduled Outages Mock Feed & Management Route
 *
 * Implements Step 20 of the Master Plan.
 * Provides endpoints for fetching local/mock scheduled outages feed (GET /scheduled-outages)
 * and adding/updating scheduled outage entries (POST /scheduled-outages).
 */

import { fetchAndCacheScheduledOutages } from '../scheduled-outages/adapter.js';

/**
 * Fastify plugin for scheduled outages routes
 * @param {import('fastify').FastifyInstance} fastify
 * @param {Object} opts
 * @param {import('@prisma/client').PrismaClient} [opts.prisma]
 */
export async function scheduledOutageRoutes(fastify, opts = {}) {
  const db = opts.prisma || fastify.prisma;

  // GET /scheduled-outages — Feed endpoint returning all stored scheduled outages
  fastify.get('/scheduled-outages', async (req, reply) => {
    try {
      const outages = await db.scheduledOutage.findMany({
        orderBy: { start: 'desc' },
      });

      return reply.code(200).send(
        outages.map((o) => ({
          id: o.id,
          scope: o.scope,
          target_id: o.target_id,
          start: o.start.toISOString(),
          end: o.end.toISOString(),
          reason: o.reason,
          fetched_at: o.fetched_at.toISOString(),
        }))
      );
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch scheduled outages');
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to retrieve scheduled outages',
      });
    }
  });

  // POST /scheduled-outages — Ingests/caches array or single scheduled outage entry
  fastify.post('/scheduled-outages', async (req, reply) => {
    const payload = Array.isArray(req.body) ? req.body : [req.body];

    try {
      const count = await fetchAndCacheScheduledOutages(payload, db);
      return reply.code(201).send({
        status: 'created',
        count,
      });
    } catch (err) {
      fastify.log.error(err, 'Failed to ingest scheduled outage entries');
      return reply.code(400).send({
        error: 'Invalid scheduled outage payload',
        message: err.message,
      });
    }
  });
}
