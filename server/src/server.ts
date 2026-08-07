import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { disconnectRetentionDatabase, runDataRetention, startRetentionScheduler } from './database/retention.js';
import { closeQueues } from './performance/queue.js';
import { disconnectRedis } from './performance/redis.js';

async function bootstrap() {
  // Fail fast if the database is unreachable.
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.error(
      { event: 'database.connection_failed', errorName: err instanceof Error ? err.name : typeof err },
      'Failed to connect to the database',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
  void runDataRetention();
  const retentionInterval = startRetentionScheduler();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      if (retentionInterval) clearInterval(retentionInterval);
      await closeQueues();
      await disconnectRedis();
      await disconnectRetentionDatabase();
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
