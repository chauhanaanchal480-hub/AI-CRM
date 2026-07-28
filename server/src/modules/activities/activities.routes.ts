import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, buildPaginationMeta } from '../../utils/apiResponse.js';
import { paginationQuery, toPrismaPagination } from '../../utils/pagination.js';
import type { Prisma } from '@prisma/client';

const listQuery = paginationQuery.extend({
  customerId: z.string().max(64).optional(),
  dealId: z.string().max(64).optional(),
  type: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING', 'STATUS_CHANGE', 'FILE', 'DEAL_UPDATE', 'TASK', 'AI_INSIGHT']).optional(),
});

export const activitiesRouter = Router();
activitiesRouter.use(authenticate);

// Global / filtered activity timeline.
activitiesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const where: Prisma.ActivityWhereInput = {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.type ? { type: q.type as Prisma.ActivityWhereInput['type'] } : {}),
      // Employees see only activity they generated or on records they own.
      ...(req.user!.role === 'EMPLOYEE'
        ? { OR: [{ userId: req.user!.sub }, { customer: { ownerId: req.user!.sub } }] }
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
        ...toPrismaPagination(q.page, q.limit),
      }),
      prisma.activity.count({ where }),
    ]);
    return sendSuccess(res, items, 200, buildPaginationMeta(q.page, q.limit, total));
  }),
);
