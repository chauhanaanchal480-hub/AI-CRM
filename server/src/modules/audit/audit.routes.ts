import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { buildPaginationMeta, sendSuccess } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';

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

type AuditQuery = z.infer<typeof auditQuery>;

function auditWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  return {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.sessionId ? { sessionId: query.sessionId } : {}),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.resource ? { resource: query.resource } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(query.success !== undefined ? { success: query.success } : {}),
    ...(query.from || query.to
      ? { timestamp: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const auditRouter = Router();
auditRouter.use(authenticate, authorize('ADMIN'));

auditRouter.get(
  '/export',
  validate({ query: auditQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as AuditQuery;
    const logs = await prisma.auditLog.findMany({
      where: auditWhere(query),
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: 10_000,
    });
    const rows = [
      ['Timestamp', 'Request ID', 'User ID', 'Session ID', 'IP', 'User Agent', 'Resource', 'Action', 'Target ID', 'Outcome', 'Status Code'],
      ...logs.map((log) => [
        log.timestamp.toISOString(),
        log.requestId,
        log.userId,
        log.sessionId,
        log.ip,
        log.userAgent,
        log.resource,
        log.action,
        log.targetId,
        log.success ? 'SUCCESS' : 'FAILURE',
        log.statusCode,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  }),
);

auditRouter.get(
  '/',
  validate({ query: auditQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as AuditQuery;
    const where = auditWhere(query);
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        ...toPrismaPagination(query.page, query.limit),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return sendSuccess(res, items, 200, buildPaginationMeta(query.page, query.limit, total));
  }),
);
