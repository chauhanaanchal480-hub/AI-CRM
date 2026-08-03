import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';
import { maskSecretText, maskSensitiveValue } from '../security/secrets.js';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/** Global error handler — last middleware in the chain. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Known application errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: maskSecretText(err.message),
        ...(err.details ? { details: maskSensitiveValue(err.details) } : {}),
      },
    });
  }

  // Body-parser failures: malformed JSON and oversized payloads.
  if (err instanceof SyntaxError && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { message: 'Malformed JSON in request body' } });
  }
  if (err instanceof Error && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { message: 'Request payload too large' } });
  }

  // Prisma known request errors → friendly messages (no query/schema internals)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: { message: 'A record with this value already exists', details: err.meta?.target },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: { message: 'Record not found' } });
    }
    if (err.code === 'P2003') {
      return res
        .status(400)
        .json({ success: false, error: { message: 'Related record does not exist' } });
    }
    // Any other Prisma error: generic response — never leak query details.
    logger.error({ code: err.code }, 'Prisma request error');
    return res.status(400).json({ success: false, error: { message: 'Invalid request' } });
  }

  // Prisma validation errors (bad field shapes reaching the client) → 400, no internals.
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma validation error');
    return res.status(400).json({ success: false, error: { message: 'Invalid request' } });
  }

  const message = err instanceof Error ? maskSecretText(err.message) : 'Internal server error';
  logger.error(
    {
      event: 'request.unhandled_error',
      errorName: err instanceof Error ? err.name : typeof err,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userId: req.user?.sub,
    },
    'Unhandled request error',
  );

  return res.status(500).json({
    success: false,
    error: { message: isProd ? 'Internal server error' : message },
  });
}
