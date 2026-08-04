/**
 * @file map.js — Topology and Physical State Map API Routes
 *
 * Exposes GET /api/map/data for frontend visualization.
 */

import { prisma as defaultPrisma } from '../db.js';

export default async function mapRoutes(fastify, opts) {
  const db = opts.prisma || defaultPrisma;

  /**
   * GET /api/map/data
   * Retrieves all feeders, transformers, and poles with their merged state.
   */
  fastify.get('/data', async (request, reply) => {
    try {
      const [feeders, transformers, poles, poleStates, topologyEdges] = await Promise.all([
        db.feeder.findMany(),
        db.transformer.findMany(),
        db.pole.findMany(),
        db.poleState.findMany(),
        db.topologyEdge.findMany()
      ]);

      const stateMap = new Map(poleStates.map(s => [s.pole_id, s]));

      const mappedPoles = poles.map(p => ({
        ...p,
        state: stateMap.get(p.id) || null
      }));

      return {
        feeders,
        transformers,
        poles: mappedPoles,
        topology_edges: topologyEdges
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
