import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let cacheConnection: Redis | undefined;
let connectionPromise: Promise<Redis | null> | undefined;
let retryAfter = 0;

function createConnection(maxRetriesPerRequest: number | null, enableOfflineQueue = maxRetriesPerRequest === null) {
  const cacheClient = maxRetriesPerRequest !== null;
  const connection = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue,
    connectTimeout: 2_000,
    commandTimeout: cacheClient ? 2_000 : undefined,
    maxRetriesPerRequest,
    connectionName: 'ai-crm-performance',
    retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000),
  });
  connection.on('error', (error: Error) => {
    logger.warn(
      { event: 'performance.redis_error', errorName: error.name },
      'Redis performance layer is temporarily unavailable',
    );
  });
  return connection;
}

/**
 * Returns the shared cache connection. A Redis outage degrades only the
 * performance layer; database-backed behavior and security remain unchanged.
 */
export async function getRedis(): Promise<Redis | null> {
  if (!env.REDIS_ENABLED || !env.REDIS_URL || Date.now() < retryAfter) return null;
  if (cacheConnection?.status === 'ready') return cacheConnection;
  // Queueing cache commands in-process during an outage creates unbounded
  // memory pressure. Let ioredis finish its reconnect and degrade to the DB.
  if (cacheConnection && ['connecting', 'connect', 'reconnecting'].includes(cacheConnection.status)) return null;
  if (cacheConnection?.status === 'end') cacheConnection = undefined;
  if (connectionPromise) return connectionPromise;

  const connection = cacheConnection ?? createConnection(1);
  cacheConnection = connection;
  connectionPromise = (connection.status === 'wait'
    ? connection.connect()
    : Promise.resolve())
    .then(() => connection.status === 'ready' ? connection : null)
    .catch((error: unknown) => {
      retryAfter = Date.now() + 5_000;
      if (cacheConnection === connection) cacheConnection = undefined;
      connection.disconnect(false);
      logger.warn(
        { event: 'performance.redis_connect_failed', errorName: error instanceof Error ? error.name : 'UNKNOWN' },
        'Continuing without Redis until the next reconnect window',
      );
      return null;
    })
    .finally(() => { connectionPromise = undefined; });
  return connectionPromise;
}

/** BullMQ requires unlimited command retries for blocking worker connections. */
export function createQueueRedisConnection() {
  if (!env.REDIS_ENABLED || !env.REDIS_URL) return null;
  // Queue producers must fail fast while Redis is unavailable; workers retain
  // their reconnect strategy without buffering unbounded producer commands.
  return createConnection(null, false);
}

export async function disconnectRedis() {
  const connection = cacheConnection;
  cacheConnection = undefined;
  connectionPromise = undefined;
  if (!connection) return;
  if (connection.status === 'ready') await connection.quit().catch(() => connection.disconnect(false));
  else connection.disconnect(false);
}
