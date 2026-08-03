import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { verifyRefreshToken } from '../utils/jwt.js';
import { writeAuditLog, type AuditEvent } from '../services/audit.service.js';

interface AuditDescriptor {
  resource: string;
  action: string;
  targetId?: string;
}

interface ResponseEnvelope {
  data?: Record<string, unknown>;
}

function crudAction(method: string, hasTarget: boolean): string | null {
  if (method === 'GET') return hasTarget ? 'READ' : 'LIST';
  if (method === 'POST') return 'CREATE';
  if (method === 'PATCH' || method === 'PUT') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return null;
}

function describeRequest(req: Request, requestPath: string): AuditDescriptor | null {
  const parts = requestPath.split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;
  const area = parts[1];

  if (area === 'auth') {
    if (req.method === 'POST' && parts[2] === 'login') return { resource: 'AUTH', action: 'LOGIN' };
    if (req.method === 'POST' && parts[2] === 'register') return { resource: 'USER', action: 'CREATE' };
    if (req.method === 'POST' && parts[2] === 'logout') return { resource: 'AUTH', action: 'LOGOUT' };
    if (parts[2] === 'sessions'
      && (req.method === 'DELETE' || parts[3]?.startsWith('logout-'))) {
      return { resource: 'AUTH', action: 'LOGOUT', targetId: parts[3] };
    }
    return null;
  }

  if (area === 'users') {
    const targetId = parts[2] && parts[2] !== 'me' ? parts[2] : req.user?.sub;
    const action = crudAction(req.method, Boolean(parts[2]));
    return action ? { resource: 'USER', action, targetId } : null;
  }

  const crudResources: Record<string, string> = {
    customers: 'CUSTOMER',
    leads: 'LEAD',
    deals: 'DEAL',
    tasks: 'TASK',
  };
  if (crudResources[area]) {
    const hasTarget = Boolean(parts[2] && parts[2] !== 'board');
    let action = crudAction(req.method, hasTarget);
    if (area === 'leads' && parts[3] === 'convert') action = 'UPDATE';
    if (area === 'deals' && parts[3] === 'move') action = 'UPDATE';
    return action ? { resource: crudResources[area], action, targetId: hasTarget ? parts[2] : undefined } : null;
  }

  if (area === 'uploads') {
    if (req.method === 'POST') return { resource: 'FILE', action: 'UPLOAD' };
    if (req.method === 'DELETE') return { resource: 'FILE', action: 'DELETE', targetId: parts[2] };
    return null;
  }

  if (area === 'ai' && req.method === 'POST') {
    return { resource: 'AI', action: 'REQUEST', targetId: parts[3] };
  }

  return null;
}

function describeSecurityEvent(requestPath: string, statusCode: number): AuditDescriptor | null {
  if (requestPath === '/api/auth/login' && statusCode >= 400) {
    return { resource: 'SECURITY', action: 'FAILED_LOGIN' };
  }
  if (requestPath.startsWith('/api/uploads') && statusCode >= 400) {
    return { resource: 'SECURITY', action: 'BLOCKED_UPLOAD' };
  }
  if (statusCode === 401) return { resource: 'SECURITY', action: 'UNAUTHORIZED_ACCESS' };
  if (statusCode === 403) return { resource: 'SECURITY', action: 'FORBIDDEN_ACCESS' };
  if (statusCode === 429) return { resource: 'SECURITY', action: 'RATE_LIMITED' };
  return null;
}

function responseData(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  return (payload as ResponseEnvelope).data;
}

function refreshIdentity(req: Request): { sub: string; sid: string } | null {
  const token = req.cookies?.refreshToken ?? req.body?.refreshToken;
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = verifyRefreshToken(token);
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

async function persistRequestAudit(
  req: Request,
  statusCode: number,
  payload: unknown,
  startedAt: Date,
  initialIdentity: { sub: string; sid: string } | null,
  requestPath: string,
) {
  const descriptor = describeRequest(req, requestPath);
  const securityDescriptor = describeSecurityEvent(requestPath, statusCode);
  if (!descriptor && !securityDescriptor) return;

  const data = responseData(payload);
  const responseUser = data?.user && typeof data.user === 'object'
    ? data.user as Record<string, unknown>
    : undefined;
  let userId = req.user?.sub
    ?? (typeof responseUser?.id === 'string' ? responseUser.id : undefined)
    ?? initialIdentity?.sub;
  const sessionId = req.user?.sid
    ?? (typeof data?.sessionId === 'string' ? data.sessionId : undefined)
    ?? initialIdentity?.sid;

  if (!userId && requestPath === '/api/auth/login' && typeof req.body?.email === 'string') {
    const user = await prisma.user.findUnique({
      where: { email: req.body.email.trim().toLowerCase() },
      select: { id: true },
    });
    userId = user?.id;
  }

  const responseTargetId = typeof data?.id === 'string' ? data.id : undefined;
  const base: Omit<AuditEvent, 'resource' | 'action' | 'targetId'> = {
    userId,
    sessionId,
    requestId: req.requestId,
    ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: req.get('user-agent') ?? 'unknown',
    timestamp: startedAt,
    success: statusCode >= 200 && statusCode < 400,
    statusCode,
    metadata: {
      method: req.method,
      path: requestPath,
      query: req.query,
      payload: req.body,
    },
  };

  const events = [descriptor, securityDescriptor].filter((item): item is AuditDescriptor => Boolean(item));
  await Promise.all(events.map((event) => writeAuditLog({
    ...base,
    resource: event.resource,
    action: event.action,
    targetId: event.targetId ?? responseTargetId ?? userId,
  })));
}

export function auditTrailMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestPath = req.originalUrl.split('?', 1)[0] || req.path;
  if (!requestPath.startsWith('/api/') || requestPath.startsWith('/api/audit')) return next();

  const startedAt = new Date();
  const initialIdentity = refreshIdentity(req);
  let payload: unknown;
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    payload = body;
    return sendJson(body);
  }) as Response['json'];

  res.once('finish', () => {
    void persistRequestAudit(req, res.statusCode, payload, startedAt, initialIdentity, requestPath).catch((error: unknown) => {
      logger.error(
        {
          event: 'audit.persist_failed',
          requestId: req.requestId,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        'Failed to persist audit log',
      );
    });
  });
  next();
}
