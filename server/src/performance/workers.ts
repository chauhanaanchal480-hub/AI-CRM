import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createQueueRedisConnection } from './redis.js';
import {
  decodeQueueValue,
  encodeQueueValue,
  queueNames,
  type QueueName,
  type SecureEnvelope,
} from './queue.js';
import type { AiJob } from './jobs.js';

const workers: Worker<SecureEnvelope, SecureEnvelope>[] = [];
const deadLetterQueues: Queue<unknown>[] = [];
const connections: NonNullable<ReturnType<typeof createQueueRedisConnection>>[] = [];

async function processAi(job: Job<SecureEnvelope>) {
  const payload = decodeQueueValue<AiJob>(job.data);
  const { aiProvider } = await import('../services/ai/index.js');
  switch (payload.operation) {
    case 'summary': return aiProvider.summarizeInteractions(payload.input);
    case 'followups': return aiProvider.suggestFollowUps(payload.input);
    case 'lead-score': return aiProvider.scoreLead(payload.input);
    case 'email-draft': return aiProvider.generateEmail(payload.input);
    case 'meeting-summary': return aiProvider.summarizeMeeting(payload.input);
  }
}

async function processCleanup() {
  const [{ runDataRetention }, { cleanupPreparedExports }] = await Promise.all([
    import('../database/retention.js'),
    import('../modules/export/export.service.js'),
  ]);
  const [retention, exports] = await Promise.all([runDataRetention(), cleanupPreparedExports()]);
  return { retention, exports };
}

async function processJob(queue: QueueName, job: Job<SecureEnvelope>) {
  switch (queue) {
    case 'ai': return processAi(job);
    case 'cleanup': return processCleanup();
    case 'export': {
      const { processExportJob } = await import('../modules/export/export.service.js');
      return processExportJob(decodeQueueValue(job.data));
    }
  }
}

export async function startWorkers() {
  if (!env.REDIS_ENABLED || !env.REDIS_URL) return [];
  if (workers.length > 0) return workers;
  for (const queueName of queueNames) {
    const workerConnection = createQueueRedisConnection();
    const dlqConnection = createQueueRedisConnection();
    if (!workerConnection || !dlqConnection) continue;
    connections.push(workerConnection, dlqConnection);
    const name = `${env.REDIS_KEY_PREFIX}-${queueName}`;
    const deadLetter = new Queue(`${name}-dead-letter`, {
      connection: dlqConnection,
      prefix: `{${env.REDIS_KEY_PREFIX}:queues}`,
    });
    deadLetterQueues.push(deadLetter);
    const worker = new Worker<SecureEnvelope, SecureEnvelope>(
      name,
      async (job) => encodeQueueValue(await processJob(queueName, job)),
      {
        connection: workerConnection,
        prefix: `{${env.REDIS_KEY_PREFIX}:queues}`,
        concurrency: env.QUEUE_WORKER_CONCURRENCY,
      },
    );
    worker.on('failed', (job, error) => {
      const attempts = Number(job?.opts.attempts ?? env.QUEUE_DEFAULT_ATTEMPTS);
      if (!job || job.attemptsMade < attempts) return;
      void deadLetter.add(`${queueName}.${job.name}`, {
        sourceJobId: job.id,
        sourceQueue: queueName,
        failedAt: new Date().toISOString(),
        attempts: job.attemptsMade,
        errorName: error.name,
        data: job.data,
      }, { removeOnComplete: false, removeOnFail: false }).catch((deadLetterError: unknown) => {
        logger.error(
          { event: 'performance.dead_letter_failed', queue: queueName, jobId: job.id, errorName: deadLetterError instanceof Error ? deadLetterError.name : 'UNKNOWN' },
          'Failed to preserve exhausted background job',
        );
      });
    });
    worker.on('error', (error) => {
      logger.error({ event: 'performance.worker_error', queue: queueName, errorName: error.name }, 'Queue worker error');
    });
    workers.push(worker);
  }

  const schedulerConnection = createQueueRedisConnection();
  if (!schedulerConnection) return workers;
  connections.push(schedulerConnection);
  const cleanupQueue = new Queue<SecureEnvelope>(`${env.REDIS_KEY_PREFIX}-cleanup`, {
    connection: schedulerConnection,
    prefix: `{${env.REDIS_KEY_PREFIX}:queues}`,
  });
  await cleanupQueue.upsertJobScheduler('data-retention', {
    every: env.DATA_RETENTION_INTERVAL_HOURS * 3_600_000,
  }, {
    name: 'data-retention',
    data: encodeQueueValue({ scheduled: true }),
    opts: {
      priority: 10,
      attempts: env.QUEUE_DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 30 * 86_400, count: 1_000 },
    },
  });
  await cleanupQueue.close();
  return workers;
}

export async function stopWorkers() {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
  await Promise.all(deadLetterQueues.splice(0).map((queue) => queue.close()));
  await Promise.all(connections.splice(0).map((connection) => connection.quit().catch(() => connection.disconnect())));
}
