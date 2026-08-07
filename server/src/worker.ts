import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { disconnectRetentionDatabase } from './database/retention.js';
import { startWorkers, stopWorkers } from './performance/workers.js';
import { disconnectRedis } from './performance/redis.js';

async function bootstrapWorker() {
  await prisma.$connect();
  const workers = await startWorkers();
  logger.info({ event: 'performance.workers_started', count: workers.length }, 'Background workers started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Background worker shutdown requested');
    await stopWorkers();
    await disconnectRedis();
    await disconnectRetentionDatabase();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrapWorker().catch((error: unknown) => {
  logger.fatal({ event: 'performance.worker_boot_failed', errorName: error instanceof Error ? error.name : 'UNKNOWN' }, 'Background worker failed to start');
  process.exit(1);
});
