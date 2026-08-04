/**
 * @file simulator.js — Fault Injection API Routes
 *
 * Exposes POST /api/simulator/inject, POST /api/simulator/repair/:faultId,
 * and GET /api/simulator/faults for end-to-end demo and testing purposes.
 *
 * These routes call injectFault / repairFault from ground-truth.js which
 * POST to the real /telemetry endpoint — so the full ingestion pipeline
 * runs exactly as it would with real IoT hardware.
 */

import { injectFault, repairFault } from '../simulator/ground-truth.js';
import { prisma as defaultPrisma } from '../db.js';

const VALID_FAULT_TYPES = ['SPAN', 'DT', 'FEEDER'];

export default async function simulatorRoutes(fastify, opts) {
  const db = opts.prisma || defaultPrisma;
  // The base URL of this same server (loopback) so ground-truth.js can POST /telemetry
  const telemetryBaseUrl = opts.telemetryBaseUrl || `http://localhost:${process.env.PORT || 3000}`;

  /**
   * POST /api/simulator/inject
   * Body: { type: 'SPAN'|'DT'|'FEEDER', target: string, duplicates?: boolean, reorder?: boolean }
   */
  fastify.post('/inject', async (request, reply) => {
    const {
      type,
      target,
      duplicates,
      duplicateResends,
      reorder,
      delayedDelivery,
    } = request.body ?? {};

    if (!type || !VALID_FAULT_TYPES.includes(type)) {
      return reply.status(400).send({
        error: `Invalid fault type. Must be one of: ${VALID_FAULT_TYPES.join(', ')}`
      });
    }
    if (!target || typeof target !== 'string') {
      return reply.status(400).send({ error: 'target is required and must be a string.' });
    }

    try {
      const options = {
        duplicates: Boolean(duplicates || duplicateResends),
        reorder: Boolean(reorder || delayedDelivery),
      };
      const result = await injectFault(type, target, telemetryBaseUrl, db, options);
      return reply.status(202).send(result);
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/simulator/repair/:faultId
   */
  fastify.post('/repair/:faultId', async (request, reply) => {
    const { faultId } = request.params;

    try {
      const result = await repairFault(faultId, telemetryBaseUrl, db);
      return reply.status(202).send(result);
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      if (err.message.includes('already repaired')) {
        return reply.status(409).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/simulator/faults
   * Lists active (unrepaired) injected faults.
   */
  fastify.get('/faults', async (request, reply) => {
    const faults = await db.simulatorFault.findMany({
      where: { repaired_at: null },
      orderBy: { injected_at: 'desc' }
    });
    return faults;
  });
}
