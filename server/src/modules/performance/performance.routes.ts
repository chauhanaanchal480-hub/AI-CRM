import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { getQueueHealth } from '../../performance/queue.js';

export const performanceRouter = Router();
performanceRouter.use(authenticate, authorize('ADMIN'));

performanceRouter.get('/queues', asyncHandler(async (_req: Request, res: Response) =>
  sendSuccess(res, await getQueueHealth()),
));
