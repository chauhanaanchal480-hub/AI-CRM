import type { NextFunction, Request, Response } from 'express';
import { sessionSecurityService } from '../modules/auth/session.service.js';
import { ApiError } from '../utils/ApiError.js';

const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

/** Requires a recent primary login or explicit step-up verification. */
export async function requireStepUp(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized());
  try {
    if (await sessionSecurityService.stepUpIsCurrent(req.user.sub, req.user.sid, STEP_UP_MAX_AGE_MS)) return next();
    return next(new ApiError(403, 'Step-up authentication required', {
      code: 'STEP_UP_REQUIRED',
      endpoint: '/api/auth/step-up',
    }));
  } catch (error) {
    return next(error);
  }
}
