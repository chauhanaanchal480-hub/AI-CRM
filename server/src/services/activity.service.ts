import { prisma } from '../lib/prisma.js';
import type { ActivityType, Prisma } from '@prisma/client';
import { invalidateCache } from '../performance/cache.js';

export interface LogActivityInput {
  type: ActivityType;
  summary: string;
  userId: string;
  customerId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

type ActivityClient = typeof prisma | Prisma.TransactionClient;

/** Persists an activity using the caller's transaction when supplied. */
export async function persistActivity(input: LogActivityInput, client: ActivityClient = prisma) {
  return client.activity.create({
    data: {
      type: input.type,
      summary: input.summary,
      userId: input.userId,
      customerId: input.customerId ?? null,
      dealId: input.dealId ?? null,
      leadId: input.leadId ?? null,
      metadata: input.metadata,
    },
  });
}

/** Invalidates caches after the activity write has committed. */
export async function invalidateActivityCache(input: LogActivityInput) {
  await invalidateCache(
    'analytics',
    ...(input.customerId ? [`customer:${input.customerId}`, `ai:customer:${input.customerId}`] : []),
    ...(input.leadId ? [`lead:${input.leadId}`] : []),
  );
}

/** Records an entry on the activity timeline. Fire-and-forget safe. */
export async function logActivity(input: LogActivityInput) {
  const activity = await persistActivity(input);
  await invalidateActivityCache(input);
  return activity;
}

interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

/** Creates an in-app notification for a user. */
export async function notify(input: NotifyInput) {
  return prisma.notification.create({ data: input });
}
