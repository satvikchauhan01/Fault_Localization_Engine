/**
 * @file db.js — Prisma client singleton for the backend
 */

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
