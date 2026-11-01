import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { notificationsService } from './notifications.service.js';

const idParam = z.object({ id: z.string().cuid('Invalid id') });

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(res, await notificationsService.list(req.user!.sub));
  }),
);

notificationsRouter.patch(
  '/:id/read',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(res, await notificationsService.markRead(req.user!.sub, req.params.id));
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(res, await notificationsService.markAllRead(req.user!.sub));
  }),
);
