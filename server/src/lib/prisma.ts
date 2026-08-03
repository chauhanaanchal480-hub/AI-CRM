import { PrismaClient } from '@prisma/client';
import { env, isDev } from '../config/env.js';

/**
 * Single shared PrismaClient. In dev we cache it on `globalThis` so that
 * tsx watch reloads don't exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isDev ? ['warn', 'error'] : ['error'],
  });

if (isDev) globalForPrisma.prisma = prisma;
