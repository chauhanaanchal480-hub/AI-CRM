import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { paginationQuery } from '../../utils/pagination.js';
import { activitiesService, type ActivityListQuery } from './activities.service.js';

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
    const { items, meta } = await activitiesService.list(
      { id: req.user!.sub, role: req.user!.role },
      q as ActivityListQuery,
    );
    return sendSuccess(res, items, 200, meta);
  }),
);
