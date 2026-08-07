import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getRedis } from './redis.js';
import { deserialize, serialize } from './serialization.js';

const CACHE_VERSION = 'v1';
const CACHE_CONTEXT = 'redis-cache';
const inFlight = new Map<string, Promise<unknown>>();

export const cacheTtl = {
  dashboard: env.CACHE_DASHBOARD_TTL_SECONDS,
  analytics: env.CACHE_ANALYTICS_TTL_SECONDS,
  entity: env.CACHE_ENTITY_TTL_SECONDS,
  ai: env.CACHE_AI_TTL_SECONDS,
} as const;

function digest(value: unknown) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(serialized ?? '').digest('base64url');
}

function dataKey(namespace: string, scope: unknown, versions: readonly string[]) {
  return `${env.REDIS_KEY_PREFIX}:cache:${CACHE_VERSION}:${namespace}:${digest(scope)}:${digest(versions)}`;
}

function tagVersionKey(tag: string) {
  return `${env.REDIS_KEY_PREFIX}:cache-version:${CACHE_VERSION}:${digest(tag)}`;
}

function encode(value: unknown) {
  const serialized = serialize(value);
  return env.secretCipher?.encrypt(serialized, CACHE_CONTEXT) ?? serialized;
}

function decode<T>(value: string): T {
  const serialized = env.secretCipher ? env.secretCipher.decrypt(value, CACHE_CONTEXT) : value;
  return deserialize<T>(serialized);
}

/** Read-through cache with per-process request coalescing to prevent stampedes. */
export async function cached<T>(options: {
  namespace: string;
  scope: unknown;
  tags: readonly string[];
  ttlSeconds: number;
  load: () => Promise<T>;
}): Promise<T> {
  let redis = await getRedis();
  const tags = [...new Set(options.tags)].sort();
  let versions = tags.map(() => '0');
  if (redis && tags.length > 0) {
    try {
      const stored = await redis.mget(...tags.map(tagVersionKey));
      versions = stored.map((version) => version ?? '0');
    } catch (error) {
      redis = null;
      logger.warn(
        { event: 'performance.cache_version_read_failed', namespace: options.namespace, errorName: error instanceof Error ? error.name : 'UNKNOWN' },
        'Cache version read failed; loading from the database',
      );
    }
  }
  const key = dataKey(options.namespace, options.scope, versions);
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const operation = (async () => {
    if (redis) {
      try {
        const hit = await redis.get(key);
        if (hit !== null) return decode<T>(hit);
      } catch (error) {
        logger.warn(
          { event: 'performance.cache_read_failed', namespace: options.namespace, errorName: error instanceof Error ? error.name : 'UNKNOWN' },
          'Cache read failed; loading from the database',
        );
      }
    }

    const value = await options.load();
    if (redis) {
      try {
        // Small deterministic jitter avoids many hot keys expiring together.
        const ttl = Math.max(1, options.ttlSeconds + (Number.parseInt(digest(key).slice(0, 2), 36) % 11) - 5);
        await redis.set(key, encode(value), 'EX', ttl);
      } catch (error) {
        logger.warn(
          { event: 'performance.cache_write_failed', namespace: options.namespace, errorName: error instanceof Error ? error.name : 'UNKNOWN' },
          'Cache write failed; returning the database result',
        );
      }
    }
    return value;
  })();

  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    inFlight.delete(key);
  }
}

/** Invalidates all concrete keys registered under the supplied domain tags. */
export async function invalidateCache(...tags: string[]) {
  if (tags.length === 0) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    const keys = [...new Set(tags)].map(tagVersionKey);
    // Versioned keys make invalidation constant-time and prevent an in-flight
    // cache fill from publishing stale data after a concurrent mutation.
    const versionTtl = Math.max(...Object.values(cacheTtl)) * 2 + 60;
    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.incr(key).expire(key, versionTtl);
    const results = await pipeline.exec();
    const commandError = results?.find(([error]) => error)?.[0];
    if (commandError) throw commandError;
  } catch (error) {
    logger.warn(
      { event: 'performance.cache_invalidation_failed', errorName: error instanceof Error ? error.name : 'UNKNOWN' },
      'Cache invalidation failed; TTL expiry remains active',
    );
  }
}
