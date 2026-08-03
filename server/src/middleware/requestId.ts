import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const supplied = req.get('x-request-id');
  req.requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
