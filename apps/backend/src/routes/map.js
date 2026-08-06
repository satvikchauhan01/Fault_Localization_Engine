/**
 * @file map.js — Topology and Physical State Map API Routes
 *
 * Exposes:
 *   GET /api/map/topology  — Static topology data (fetched once by UI on mount)
 *   GET /api/map/state     — Dynamic PoleState snapshot (polled every few seconds)
 *   GET /api/map/data      — Legacy combined endpoint (kept for compatibility)
 */

import { prisma as defaultPrisma } from '../db.js';

export default async function mapRoutes(fastify, opts) {
  const db = opts.prisma || defaultPrisma;

  /**
   * GET /api/map/topology
   * Returns the static network topology: feeders, transformers, poles, edges.
   * This data changes only on reseed — the frontend fetches it ONCE on mount.
   */
  fastify.get('/topology', async (request, reply) => {
    try {
      const [feeders, transformers, poles, topologyEdges] = await Promise.all([
        db.feeder.findMany(),
        db.transformer.findMany(),
        db.pole.findMany(),
        db.topologyEdge.findMany(),
      ]);

      return { feeders, transformers, poles, topology_edges: topologyEdges };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/map/state
   * Returns ONLY the current PoleState rows (one per monitored pole).
   * This is the lightweight endpoint polled every few seconds by the UI.
   * Payload is ~70x smaller than /data because it omits topology.
   */
  fastify.get('/state', async (request, reply) => {
    try {
      const poleStates = await db.poleState.findMany();
      return { pole_states: poleStates };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET /api/map/data
   * Legacy combined endpoint — kept for backward compatibility.
   * Prefer /topology + /state for new code.
   */
  fastify.get('/data', async (request, reply) => {
    try {
      const [feeders, transformers, poles, poleStates, topologyEdges] = await Promise.all([
        db.feeder.findMany(),
        db.transformer.findMany(),
        db.pole.findMany(),
        db.poleState.findMany(),
        db.topologyEdge.findMany(),
      ]);

      const stateMap = new Map(poleStates.map(s => [s.pole_id, s]));
      const mappedPoles = poles.map(p => ({ ...p, state: stateMap.get(p.id) || null }));

      return { feeders, transformers, poles: mappedPoles, topology_edges: topologyEdges };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
