/**
 * @file app.js — Fastify application factory
 *
 * Configures Fastify instance, registers routes, and decorates fastify with prisma client.
 */

import Fastify from 'fastify';
import { prisma as defaultPrisma } from './db.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { scheduledOutageRoutes } from './routes/scheduled-outages.js';
import ticketRoutes from './routes/tickets.js';

/**
 * Builds and configures Fastify server instance.
 * @param {Object} [opts]
 * @param {import('@prisma/client').PrismaClient} [opts.prisma]
 * @param {boolean|Object} [opts.logger]
 * @returns {import('fastify').FastifyInstance}
 */
export function buildApp(opts = {}) {
  const logger = opts.logger ?? (process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL || 'info' });

  const app = Fastify({ logger });
  const prisma = opts.prisma || defaultPrisma;

  app.decorate('prisma', prisma);

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', service: 'kspdb-backend' };
  });

  // Telemetry routes
  app.register(telemetryRoutes, { prisma });

  // Scheduled outages routes
  app.register(scheduledOutageRoutes, { prisma });

  // Ticket routes
  app.register(ticketRoutes, { prefix: '/api/tickets' });

  return app;
}
