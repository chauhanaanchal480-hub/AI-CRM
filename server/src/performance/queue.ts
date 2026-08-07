import { Queue, QueueEvents } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createQueueRedisConnection } from './redis.js';
import { deserialize, serialize } from './serialization.js';

export const queueNames = ['ai', 'export', 'cleanup'] as const;
export type QueueName = typeof queueNames[number];

interface SecureEnvelope {
  version: 1;
  encrypted: boolean;
  payload: string;
}

interface QueueRuntime {
  queue: Queue<SecureEnvelope>;
  events: QueueEvents;
}

const runtimes = new Map<QueueName, QueueRuntime>();
const connections: ReturnType<typeof createQueueRedisConnection>[] = [];
const QUEUE_CONTEXT = 'redis-queue';

export function encodeQueueValue(value: unknown): SecureEnvelope {
  const serialized = serialize(value);
  return {
    version: 1,
    encrypted: Boolean(env.secretCipher),
    payload: env.secretCipher?.encrypt(serialized, QUEUE_CONTEXT) ?? serialized,
  };
}

export function decodeQueueValue<T>(envelope: SecureEnvelope): T {
  if (!envelope || envelope.version !== 1 || typeof envelope.payload !== 'string') {
    throw new Error('Invalid queue payload envelope');
  }
  if (envelope.encrypted && !env.secretCipher) throw new Error('Queue encryption key is unavailable');
  const serialized = envelope.encrypted
    ? env.secretCipher!.decrypt(envelope.payload, QUEUE_CONTEXT)
    : envelope.payload;
  return deserialize<T>(serialized);
}

function getRuntime(name: QueueName): QueueRuntime | null {
  if (!env.REDIS_ENABLED || !env.REDIS_URL) return null;
  const existing = runtimes.get(name);
  if (existing) return existing;
  const queueConnection = createQueueRedisConnection();
  const eventConnection = createQueueRedisConnection();
  if (!queueConnection || !eventConnection) return null;
  connections.push(queueConnection, eventConnection);
  const queueName = `${env.REDIS_KEY_PREFIX}-${name}`;
  const queue = new Queue<SecureEnvelope>(queueName, {
    connection: queueConnection,
    prefix: `{${env.REDIS_KEY_PREFIX}:queues}`,
    defaultJobOptions: {
      attempts: env.QUEUE_DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 86_400, count: 10_000 },
    },
  });
  const events = new QueueEvents(queueName, {
    connection: eventConnection,
    prefix: `{${env.REDIS_KEY_PREFIX}:queues}`,
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.warn({ event: 'performance.queue_job_failed', queue: name, jobId, failedReason }, 'Background job failed');
  });
  events.on('completed', ({ jobId }) => {
    logger.info({ event: 'performance.queue_job_completed', queue: name, jobId }, 'Background job completed');
  });
  const runtime = { queue, events };
  runtimes.set(name, runtime);
  return runtime;
}

export async function runQueuedJob<TPayload, TResult>(options: {
  queue: QueueName;
  name: string;
  payload: TPayload;
  fallback: () => Promise<TResult>;
  priority?: number;
  jobOptions?: Omit<JobsOptions, 'priority'>;
}): Promise<TResult> {
  const runtime = getRuntime(options.queue);
  if (!runtime) return options.fallback();
  let job;
  try {
    job = await runtime.queue.add(options.name, encodeQueueValue(options.payload), {
      priority: options.priority ?? 5,
      ...options.jobOptions,
    });
  } catch (error) {
    logger.warn(
      { event: 'performance.queue_enqueue_failed', queue: options.queue, errorName: error instanceof Error ? error.name : 'UNKNOWN' },
      'Queue enqueue failed; executing the job inline',
    );
    return options.fallback();
  }
  const result = await job.waitUntilFinished(runtime.events, env.QUEUE_JOB_TIMEOUT_MS);
  return decodeQueueValue<TResult>(result as SecureEnvelope);
}

export async function getQueueHealth() {
  if (!env.REDIS_ENABLED || !env.REDIS_URL) return { enabled: false, queues: [] };
  const queues = await Promise.all(queueNames.map(async (name) => {
    const runtime = getRuntime(name);
    try {
      const counts = runtime
        ? await Promise.race([
          runtime.queue.getJobCounts('active', 'waiting', 'delayed', 'completed', 'failed', 'prioritized'),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis health check timed out')), 2_000)),
        ])
        : {};
      return { name, status: 'ready' as const, counts };
    } catch (error) {
      return { name, status: 'degraded' as const, counts: {}, error: error instanceof Error ? error.name : 'UNKNOWN' };
    }
  }));
  return { enabled: true, queues };
}

export async function closeQueues() {
  await Promise.all([...runtimes.values()].flatMap(({ queue, events }) => [queue.close(), events.close()]));
  runtimes.clear();
  await Promise.all(connections.splice(0).map((connection) => connection?.quit().catch(() => connection.disconnect())));
}

export type { SecureEnvelope };
