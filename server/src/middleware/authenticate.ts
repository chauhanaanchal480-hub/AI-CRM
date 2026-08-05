import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { sessionSecurityService } from '../modules/auth/session.service.js';
import { setDatabaseActor } from '../database/securityContext.js';

/**
 * Requires a valid Bearer access token. Populates `req.user`.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    if (!(await sessionSecurityService.validateAccessSession(payload.sub, payload.sid))) {
      return next(ApiError.unauthorized('Session expired or revoked'));
    }
    req.user = payload;
    setDatabaseActor(payload.sub);
    return next();
  } catch {
    return next(ApiError.unauthorized('Invalid or expired access token'));
  }
}
