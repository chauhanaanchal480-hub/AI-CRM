import { prisma } from '../lib/prisma.js';
import type { ActivityType, Prisma } from '@prisma/client';
import { invalidateCache } from '../performance/cache.js';

interface LogActivityInput {
  type: ActivityType;
  summary: string;
  userId: string;
  customerId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Records an entry on the activity timeline. Fire-and-forget safe. */
export async function logActivity(input: LogActivityInput) {
  const activity = await prisma.activity.create({
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
  await invalidateCache(
    'analytics',
    ...(input.customerId ? [`customer:${input.customerId}`, `ai:customer:${input.customerId}`] : []),
    ...(input.leadId ? [`lead:${input.leadId}`] : []),
  );
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
