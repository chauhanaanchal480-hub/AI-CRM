import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { apiSecurityConfig } from '../config/apiSecurity.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ApiError } from '../utils/ApiError.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CLEANUP_INTERVAL_MS = 60 * 60_000;
const PENDING_STALE_MS = 30_000;
let lastCleanupAt = 0;

function digest(value: crypto.BinaryLike) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestHash(req: Request) {
  const body = req.rawBody ?? Buffer.from(req.body === undefined ? '' : JSON.stringify(req.body), 'utf8');
  return digest(`${req.method.toUpperCase()}\n${req.originalUrl}\n${digest(body)}`);
}

function scopeHash(req: Request) {
  if (req.apiClientId) return digest(`hmac:${req.apiClientId}`);
  const authorization = req.get('authorization');
  if (authorization) return digest(`authorization:${authorization}`);
  return digest(`anonymous:${req.ip ?? 'unknown'}:${req.get('user-agent') ?? 'unknown'}`);
}

function isExcluded(req: Request) {
  return req.path.startsWith('/auth/')
    || req.path === '/auth'
    || req.path.startsWith('/uploads')
    || req.path === '/docs'
    || req.path === '/openapi.json';
}

async function cleanupExpiredRecords(now = new Date()) {
  if (now.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  await prisma.apiIdempotencyRecord.deleteMany({ where: { expiresAt: { lte: now } } });
  lastCleanupAt = now.getTime();
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredRecords().catch((error) => {
    logger.error(
      { event: 'security.idempotency_cleanup_failed', errorName: error instanceof Error ? error.name : typeof error },
      'Expired idempotency record cleanup failed',
    );
  });
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findCompletedRecord(recordId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const record = await prisma.apiIdempotencyRecord.findUnique({ where: { id: recordId } });
    if (!record || record.state === 'COMPLETED') return record;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return prisma.apiIdempotencyRecord.findUnique({ where: { id: recordId } });
}

async function handleExisting(
  req: Request,
  res: Response,
  next: NextFunction,
  existing: Awaited<ReturnType<typeof prisma.apiIdempotencyRecord.findUnique>>,
  hash: string,
) {
  if (!existing) return next(new ApiError(409, 'Idempotency request could not be resolved', { code: 'IDEMPOTENCY_CONFLICT' }));
  const now = new Date();
  if (existing.expiresAt <= now || (existing.state === 'PENDING' && now.getTime() - existing.createdAt.getTime() > PENDING_STALE_MS)) {
    await prisma.apiIdempotencyRecord.deleteMany({ where: { id: existing.id } });
    return idempotencyMiddleware(req, res, next);
  }
  if (existing.requestHash !== hash) {
    return next(new ApiError(409, 'Idempotency key was already used for a different request', {
      code: 'IDEMPOTENCY_KEY_REUSED',
    }));
  }

  const completed = existing.state === 'COMPLETED' ? existing : await findCompletedRecord(existing.id);
  if (!completed || completed.state !== 'COMPLETED' || completed.statusCode === null || completed.responseBody === null) {
    res.setHeader('Retry-After', '1');
    return next(new ApiError(409, 'An identical request with this idempotency key is still being processed', {
      code: 'IDEMPOTENCY_IN_PROGRESS',
    }));
  }
  res.setHeader('Idempotency-Replayed', 'true');
  res.setHeader('Idempotency-Key', existing.key);
  return res.status(completed.statusCode).json(completed.responseBody);
}

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<unknown> {
  try {
    if (!UNSAFE_METHODS.has(req.method) || isExcluded(req)) return next();
    const key = req.get('idempotency-key')?.trim();
    if (!key) return next();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      return next(ApiError.badRequest('Idempotency-Key must contain 8-128 safe characters', {
        code: 'IDEMPOTENCY_KEY_INVALID',
      }));
    }

    const now = new Date();
    const scope = scopeHash(req);
    const hash = requestHash(req);
    await cleanupExpiredRecords(now);

    let record;
    try {
      record = await prisma.apiIdempotencyRecord.create({
        data: {
          scopeHash: scope,
          key,
          requestHash: hash,
          expiresAt: new Date(now.getTime() + apiSecurityConfig.idempotencyTtlHours * 60 * 60_000),
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await prisma.apiIdempotencyRecord.findUnique({
        where: { scopeHash_key: { scopeHash: scope, key } },
      });
      return handleExisting(req, res, next, existing, hash);
    }

    res.setHeader('Idempotency-Key', key);
    let capturedBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      capturedBody = body;
      return originalJson(body);
    }) as Response['json'];

    res.once('finish', () => {
      if (capturedBody === undefined) {
        void prisma.apiIdempotencyRecord.deleteMany({ where: { id: record.id } });
        return;
      }
      void prisma.apiIdempotencyRecord.updateMany({
        where: { id: record.id, state: 'PENDING' },
        data: {
          state: 'COMPLETED',
          statusCode: res.statusCode,
          responseBody: jsonValue(capturedBody),
          completedAt: new Date(),
        },
      }).catch((error) => {
        logger.error(
          { event: 'security.idempotency_persist_failed', requestId: req.requestId, errorName: error instanceof Error ? error.name : typeof error },
          'Idempotency response persistence failed',
        );
      });
    });
    return next();
  } catch (error) {
    return next(error);
  }
}
