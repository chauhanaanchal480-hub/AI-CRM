import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { ApiError } from '../utils/ApiError.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createOriginValidation(allowedOrigins: ReadonlySet<string>) {
  return function originValidation(req: Request, _res: Response, next: NextFunction) {
    const suppliedOrigin = req.get('origin');
    const origin = suppliedOrigin ? normalizeOrigin(suppliedOrigin) : null;
    if (suppliedOrigin && (!origin || !allowedOrigins.has(origin))) {
      logger.warn(
        { event: 'security.api_origin_rejected', requestId: req.requestId, origin: origin ?? 'invalid' },
        'API request from an untrusted origin rejected',
      );
      return next(new ApiError(403, 'Request origin is not allowed', { code: 'ORIGIN_NOT_ALLOWED' }));
    }

    const referer = req.get('referer');
    if (!suppliedOrigin && referer && UNSAFE_METHODS.has(req.method)) {
      let refererOrigin: string | null = null;
      try {
        refererOrigin = new URL(referer).origin;
      } catch {
        // Invalid referrers are rejected below.
      }
      if (!refererOrigin || !allowedOrigins.has(refererOrigin)) {
        return next(new ApiError(403, 'Request referrer is not allowed', { code: 'ORIGIN_NOT_ALLOWED' }));
      }
    }

    if (!suppliedOrigin && req.get('sec-fetch-site') === 'cross-site' && UNSAFE_METHODS.has(req.method)) {
      return next(new ApiError(403, 'Cross-site API request is not allowed', { code: 'CROSS_SITE_REQUEST_BLOCKED' }));
    }
    return next();
  };
}
