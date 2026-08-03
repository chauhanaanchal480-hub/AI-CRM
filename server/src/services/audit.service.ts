import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

const SENSITIVE_KEY = /(?:password|passcode|token|secret|authorization|cookie|api[-_]?key|email|phone|transcript|content|credit|ssn)/i;
const MAX_STRING_LENGTH = 2_000;
const MAX_COLLECTION_SIZE = 50;

export function maskSensitiveValues(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonSafe {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[BINARY]';
  if (typeof value !== 'object') return String(value).slice(0, MAX_STRING_LENGTH);
  if (depth >= 6 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_SIZE).map((item) => maskSensitiveValues(item, depth + 1, seen));
  }

  const masked: Record<string, JsonSafe> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_SIZE)) {
    masked[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : maskSensitiveValues(item, depth + 1, seen);
  }
  return masked;
}

export interface AuditEvent {
  userId?: string | null;
  sessionId?: string | null;
  requestId: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
  resource: string;
  action: string;
  targetId?: string | null;
  success: boolean;
  statusCode: number;
  metadata?: unknown;
}

export function writeAuditLog(event: AuditEvent) {
  return prisma.auditLog.create({
    data: {
      userId: event.userId ?? null,
      sessionId: event.sessionId ?? null,
      requestId: event.requestId,
      ip: event.ip.slice(0, 64),
      userAgent: event.userAgent.slice(0, 512),
      timestamp: event.timestamp,
      resource: event.resource.slice(0, 64),
      action: event.action.slice(0, 64),
      targetId: event.targetId?.slice(0, 191) ?? null,
      success: event.success,
      statusCode: event.statusCode,
      metadata: event.metadata === undefined
        ? undefined
        : maskSensitiveValues(event.metadata) as Prisma.InputJsonValue,
    },
  });
}
