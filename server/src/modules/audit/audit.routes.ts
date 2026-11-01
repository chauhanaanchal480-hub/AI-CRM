import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { auditService, type AuditQuery } from './audit.service.js';

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().cuid().optional(),
  sessionId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  resource: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()).optional(),
  action: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()).optional(),
  targetId: z.string().trim().min(1).max(191).optional(),
  success: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'from must be before to',
  path: ['from'],
});

export const auditRouter = Router();
auditRouter.use(authenticate, authorize('ADMIN'));

auditRouter.get(
  '/export',
  validate({ query: auditQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof auditQuery>;
    const csv = await auditService.exportCsv(query as AuditQuery);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  }),
);

auditRouter.get(
  '/',
  validate({ query: auditQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof auditQuery>;
    const { items, meta } = await auditService.list(query as AuditQuery);
    return sendSuccess(res, items, 200, meta);
  }),
);
