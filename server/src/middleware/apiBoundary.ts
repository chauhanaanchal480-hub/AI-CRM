import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';

const LEGACY_SUNSET = 'Wed, 30 Jun 2027 00:00:00 GMT';

export function secureApiResponse(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-API-Version', req.apiVersion ?? '1');
  res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  const accept = req.get('accept');
  if (accept && !accept.includes('*/*') && !accept.includes('application/json') && !accept.includes('+json')) {
    return next(new ApiError(406, 'This API only produces JSON responses', { code: 'JSON_RESPONSE_REQUIRED' }));
  }
  return next();
}

export function canonicalApiVersion(req: Request, _res: Response, next: NextFunction) {
  req.apiVersion = '1';
  next();
}

export function legacyApiVersion(req: Request, res: Response, next: NextFunction) {
  req.apiVersion = '1';
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', LEGACY_SUNSET);
  res.setHeader('Link', `</api/v1${req.path === '/' ? '' : req.path}>; rel="successor-version"`);
  next();
}

export function rejectUnsupportedApiVersion(req: Request, _res: Response, next: NextFunction) {
  const match = /^\/v(\d+)(?:\/|$)/i.exec(req.path);
  if (match && match[1] !== '1') {
    return next(new ApiError(400, `API version v${match[1]} is not supported`, {
      code: 'UNSUPPORTED_API_VERSION',
      supportedVersions: ['v1'],
    }));
  }
  return next();
}
