import type { ActivityType, Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { buildPaginationMeta } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';

interface Actor { id: string; role: Role; }

export interface ActivityListQuery {
  page: number;
  limit: number;
  customerId?: string;
  dealId?: string;
  type?: ActivityType;
}

export const activitiesService = {
  async list(actor: Actor, query: ActivityListQuery) {
    const where: Prisma.ActivityWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(actor.role === 'EMPLOYEE'
        ? { OR: [{ userId: actor.id }, { customer: { ownerId: actor.id } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...toPrismaPagination(query.page, query.limit),
      }),
      prisma.activity.count({ where }),
    ]);
    return { items, meta: buildPaginationMeta(query.page, query.limit, total) };
  },
};
