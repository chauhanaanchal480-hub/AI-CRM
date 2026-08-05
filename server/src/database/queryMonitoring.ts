import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { logger } from '../lib/logger.js';

interface QueryAggregate {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  errors: number;
}

const MAX_FINGERPRINTS = 500;

export function createQueryMonitor(options: { slowMs: number; sampleRate: number }) {
  const aggregates = new Map<string, QueryAggregate>();

  const aggregateFor = (fingerprint: string) => {
    let aggregate = aggregates.get(fingerprint);
    if (!aggregate) {
      if (aggregates.size >= MAX_FINGERPRINTS) aggregates.delete(aggregates.keys().next().value as string);
      aggregate = { count: 0, totalDurationMs: 0, maxDurationMs: 0, errors: 0 };
      aggregates.set(fingerprint, aggregate);
    }
    return aggregate;
  };

  const fingerprint = (query: string) => crypto
    .createHash('sha256')
    .update(query.replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 16);

  return {
    onQuery(event: Prisma.QueryEvent) {
      const id = fingerprint(event.query);
      const aggregate = aggregateFor(id);
      aggregate.count += 1;
      aggregate.totalDurationMs += event.duration;
      aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, event.duration);
      const details = {
        event: event.duration >= options.slowMs ? 'database.slow_query' : 'database.query_sample',
        fingerprint: id,
        durationMs: event.duration,
        target: event.target,
      };
      if (event.duration >= options.slowMs) logger.warn(details, 'Slow database query detected');
      else if (Math.random() < options.sampleRate) logger.debug(details, 'Database query sample');
    },
    onError(model: string | undefined, action: string, error: unknown) {
      const id = crypto.createHash('sha256').update(`${model ?? 'raw'}:${action}`).digest('hex').slice(0, 16);
      aggregateFor(id).errors += 1;
      logger.error(
        {
          event: 'database.query_failed',
          fingerprint: id,
          model,
          action,
          errorCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined,
        },
        'Database query failed',
      );
    },
    snapshot() {
      return [...aggregates.entries()].map(([id, value]) => ({
        fingerprint: id,
        count: value.count,
        averageDurationMs: value.count ? Math.round((value.totalDurationMs / value.count) * 100) / 100 : 0,
        maxDurationMs: value.maxDurationMs,
        errors: value.errors,
      }));
    },
  };
}
