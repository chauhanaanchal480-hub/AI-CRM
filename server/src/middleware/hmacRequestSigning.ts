import crypto from 'node:crypto';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { apiSecurityConfig } from '../config/apiSecurity.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { writeAuditLog } from '../services/audit.service.js';
import { ApiError } from '../utils/ApiError.js';

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const TIMESTAMP_PATTERN = /^\d{10}$/;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
let lastCleanupAt = 0;

function sha256(value: crypto.BinaryLike) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalTarget(req: Request) {
  const url = new URL(req.originalUrl, 'http://api.local');
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = leftKey.localeCompare(rightKey);
    return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
  });
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function multipartFields(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.entries(body as Record<string, unknown>)
    .flatMap(([name, value]) => (Array.isArray(value) ? value : [value])
      .map((item) => [name, typeof item === 'string' ? item : String(item)] as const))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = leftName.localeCompare(rightName);
      return nameOrder === 0 ? leftValue.localeCompare(rightValue) : nameOrder;
    });
}

async function canonicalBody(req: Request) {
  if (!req.is('multipart/form-data')) {
    if (req.rawBody) return req.rawBody;
    const hasWireBody = req.get('content-length') !== undefined || req.get('transfer-encoding') !== undefined;
    return Buffer.from(!hasWireBody || req.body === undefined ? '' : JSON.stringify(req.body), 'utf8');
  }

  const files = req.file
    ? [{
        fieldName: req.file.fieldname,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        sha256: sha256(await fs.promises.readFile(req.file.path)),
      }]
    : [];
  return Buffer.from(JSON.stringify({ fields: multipartFields(req.body), files }), 'utf8');
}

async function canonicalPayload(req: Request, timestamp: string, nonce: string) {
  const body = await canonicalBody(req);
  return [req.method.toUpperCase(), canonicalTarget(req), timestamp, nonce, sha256(body)].join('\n');
}

async function cleanupExpiredNonces(now = new Date()) {
  if (now.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  await prisma.apiRequestNonce.deleteMany({ where: { expiresAt: { lte: now } } });
  lastCleanupAt = now.getTime();
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredNonces().catch((error) => {
    logger.error(
      { event: 'security.api_nonce_cleanup_failed', errorName: error instanceof Error ? error.name : typeof error },
      'Expired API signing nonce cleanup failed',
    );
  });
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function signingError(message: string, code: string) {
  return new ApiError(401, message, { code });
}

function signingLog(req: Request, event: string, message: string, keyId?: string) {
  logger.warn({ event, keyId, requestId: req.requestId }, message);
}

async function persistSigningAudit(
  req: Request,
  keyId: string,
  action: 'API_SIGNATURE_VERIFIED' | 'API_SIGNATURE_REPLAY_REJECTED',
  success: boolean,
  statusCode: number,
) {
  try {
    await writeAuditLog({
      userId: req.user?.sub,
      sessionId: req.user?.sid,
      requestId: req.requestId,
      ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      userAgent: req.get('user-agent') ?? 'unknown',
      timestamp: new Date(),
      resource: 'SECURITY',
      action,
      targetId: keyId,
      success,
      statusCode,
      metadata: { method: req.method, path: req.originalUrl.split('?', 1)[0], keyId },
    });
  } catch (error) {
    logger.error(
      {
        event: 'audit.api_signature_persist_failed',
        keyId,
        requestId: req.requestId,
        errorName: error instanceof Error ? error.name : typeof error,
      },
      'Failed to persist API signature audit event',
    );
  }
}

export async function hmacRequestSigning(req: Request, res: Response, next: NextFunction) {
  const keyId = req.get('x-api-key-id')?.trim();
  const timestamp = req.get('x-api-timestamp')?.trim();
  const nonce = req.get('x-api-nonce')?.trim();
  const suppliedSignature = req.get('x-api-signature')?.trim();
  const supplied = [keyId, timestamp, nonce, suppliedSignature].filter(Boolean).length;

  if (supplied === 0 && !apiSecurityConfig.hmacRequired) return next();
  if (supplied !== 4 || !keyId || !timestamp || !nonce || !suppliedSignature) {
    signingLog(req, 'security.api_signature_headers_missing', 'Required API HMAC signing headers are missing', keyId);
    return next(signingError('Complete HMAC signing headers are required', 'HMAC_HEADERS_INCOMPLETE'));
  }
  if (!TIMESTAMP_PATTERN.test(timestamp) || !NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(suppliedSignature)) {
    signingLog(req, 'security.api_signature_headers_malformed', 'API HMAC signing headers are malformed', keyId);
    return next(signingError('HMAC signing headers are malformed', 'HMAC_HEADERS_INVALID'));
  }

  const key = apiSecurityConfig.hmacKeys.get(keyId);
  if (!key) {
    signingLog(req, 'security.api_signature_key_unknown', 'Unknown API HMAC signing key rejected', keyId);
    return next(signingError('Unknown API signing key', 'HMAC_KEY_UNKNOWN'));
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - timestampSeconds > apiSecurityConfig.hmacClockSkewSeconds) {
    signingLog(req, 'security.api_signature_timestamp_expired', 'Expired API HMAC timestamp rejected', keyId);
    return next(signingError('API request signature has expired', 'HMAC_TIMESTAMP_EXPIRED'));
  }
  if (timestampSeconds - nowSeconds > apiSecurityConfig.hmacClockSkewSeconds) {
    signingLog(req, 'security.api_signature_timestamp_future', 'Future API HMAC timestamp rejected', keyId);
    return next(signingError('API request signature has expired', 'HMAC_TIMESTAMP_EXPIRED'));
  }

  // Multer must parse multipart content before its semantic fields and file
  // bytes can be canonicalized. The upload route invokes this same middleware
  // again immediately after parsing.
  if (req.is('multipart/form-data') && !req.multipartBodyParsed) return next();

  let payload: string;
  try {
    payload = await canonicalPayload(req, timestamp, nonce);
  } catch (error) {
    return next(error);
  }
  const expected = crypto.createHmac('sha256', key).update(payload).digest();
  const received = Buffer.from(suppliedSignature, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    signingLog(req, 'security.api_signature_rejected', 'Invalid API HMAC signature', keyId);
    return next(signingError('Invalid API request signature', 'HMAC_SIGNATURE_INVALID'));
  }

  const now = new Date();
  try {
    await cleanupExpiredNonces(now);
    await prisma.apiRequestNonce.create({
      data: {
        keyId,
        nonce,
        requestHash: sha256(payload),
        expiresAt: new Date(now.getTime() + apiSecurityConfig.hmacClockSkewSeconds * 2_000),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      signingLog(req, 'security.api_signature_replay', 'Replayed API request signature blocked', keyId);
      await persistSigningAudit(req, keyId, 'API_SIGNATURE_REPLAY_REJECTED', false, 409);
      return next(new ApiError(409, 'API request signature nonce has already been used', {
        code: 'HMAC_REPLAY_DETECTED',
      }));
    }
    return next(error);
  }

  req.apiClientId = keyId;
  res.setHeader('X-Signature-Verified', 'true');
  logger.info({ event: 'security.api_signature_verified', keyId, requestId: req.requestId }, 'API HMAC signature verified');
  await persistSigningAudit(req, keyId, 'API_SIGNATURE_VERIFIED', true, 200);
  return next();
}

export function hmacMultipartRequestSigning(req: Request, res: Response, next: NextFunction) {
  req.multipartBodyParsed = true;
  void hmacRequestSigning(req, res, (error?: unknown) => {
    if (!error || !req.file?.path) return next(error);
    void fs.promises.unlink(req.file.path).catch(() => undefined).finally(() => next(error));
  });
}
