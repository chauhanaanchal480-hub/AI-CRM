import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

const idParam = z.object({ id: z.string().cuid('Invalid id') });

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: req.user!.sub, read: false } }),
    ]);
    return sendSuccess(res, { items, unread });
  }),
);

notificationsRouter.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif || notif.userId !== req.user!.sub) throw ApiError.notFound('Notification not found');
    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    return sendSuccess(res, updated);
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.sub, read: false }, data: { read: true } });
    return sendSuccess(res, { message: 'All notifications marked as read' });
  }),
);
