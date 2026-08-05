import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { createFieldSecurity } from '../database/fieldSecurity.js';
import { createPrismaSecurityMiddleware } from '../database/prismaSecurity.js';
import { createQueryMonitor } from '../database/queryMonitoring.js';

/**
 * Single shared PrismaClient. In dev we cache it on `globalThis` so that
 * tsx watch reloads don't exhaust the connection pool.
 */
const createPrismaClient = () => new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
  databaseSecurityConfigured?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

export const fieldSecurity = createFieldSecurity({
  cipher: env.secretCipher,
  enabled: env.FIELD_ENCRYPTION_ENABLED,
  searchKey: env.FIELD_SEARCH_KEY,
  developmentFallback: env.JWT_ACCESS_SECRET,
});

export const databaseQueryMonitor = createQueryMonitor({
  slowMs: env.DB_QUERY_SLOW_MS,
  sampleRate: env.DB_QUERY_LOG_SAMPLE_RATE,
});

if (!globalForPrisma.databaseSecurityConfigured) {
  prisma.$on('query', (event) => databaseQueryMonitor.onQuery(event));
  prisma.$use(createPrismaSecurityMiddleware({
    fields: fieldSecurity,
    onError: (model, action, error) => databaseQueryMonitor.onError(model, action, error),
  }));
  globalForPrisma.databaseSecurityConfigured = true;
}

if (env.NODE_ENV === 'development') globalForPrisma.prisma = prisma;
