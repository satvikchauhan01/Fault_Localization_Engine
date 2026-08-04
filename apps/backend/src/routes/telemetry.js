/**
 * @file telemetry.js — Telemetry Ingestion Route (POST /telemetry)
 *
 * Implements Step 18 of the Master Plan.
 * Accepts incoming device/simulator telemetry payloads, validates against
 * TelemetryIngestSchema, writes to the telemetry_inbox queue table in Postgres
 * with status 'PENDING', and returns a fast 202 Accepted acknowledgement.
 */

import { TelemetryIngestSchema } from '@kspdb/domain/schemas';

/**
 * Fastify plugin for telemetry route
 * @param {import('fastify').FastifyInstance} fastify
 * @param {Object} opts
 * @param {import('@prisma/client').PrismaClient} [opts.prisma]
 */
export async function telemetryRoutes(fastify, opts = {}) {
  const db = opts.prisma || fastify.prisma;

  fastify.post('/telemetry', async (req, reply) => {
    const parseResult = TelemetryIngestSchema.safeParse(req.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid telemetry payload',
        details: parseResult.error.issues,
      });
    }

    const data = parseResult.data;
    const serverReceivedAt = data.server_received_at
      ? new Date(data.server_received_at)
      : new Date();

    try {
      const inboxItem = await db.telemetryInbox.create({
        data: {
          device_id: data.device_id,
          pole_id: data.pole_id,
          event: data.event,
          energized: data.energized,
          device_ts: new Date(data.device_ts),
          seq: data.seq,
          battery_mv: data.battery_mv ?? null,
          rssi: data.rssi ?? null,
          fw: data.fw,
          server_received_at: serverReceivedAt,
          status: 'PENDING',
        },
      });

      return reply.code(202).send({
        status: 'accepted',
        id: inboxItem.id,
      });
    } catch (err) {
      fastify.log.error(err, 'Failed to insert telemetry event into inbox');
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to write telemetry to inbox',
      });
    }
  });
}
