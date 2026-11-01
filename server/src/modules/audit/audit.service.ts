import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { buildPaginationMeta } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';

export interface AuditQuery {
  page: number;
  limit: number;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  resource?: string;
  action?: string;
  targetId?: string;
  success?: boolean;
  from?: Date;
  to?: Date;
}

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

export const auditService = {
  async list(query: AuditQuery) {
    const where = auditWhere(query);
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        ...toPrismaPagination(query.page, query.limit),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, meta: buildPaginationMeta(query.page, query.limit, total) };
  },

  async exportCsv(query: AuditQuery) {
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
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  },
};
