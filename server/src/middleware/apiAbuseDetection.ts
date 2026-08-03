import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { apiSecurityConfig } from '../config/apiSecurity.js';
import { logger } from '../lib/logger.js';
import { ApiError } from '../utils/ApiError.js';

interface AbuseBucket {
  strikes: number;
  resetAt: number;
}

const buckets = new Map<string, AbuseBucket>();
const SIGNAL_STATUSES = new Set([400, 401, 403, 404, 409, 413, 414, 415, 422, 429]);

function clientKey(req: Request) {
  const identity = req.apiClientId ?? req.get('authorization') ?? `${req.ip}:${req.get('user-agent') ?? 'unknown'}`;
  return crypto.createHash('sha256').update(identity).update('\n').update(req.path).digest('hex');
}

function payloadComplexity(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let maximumDepth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    maximumDepth = Math.max(maximumDepth, current.depth);
    if (nodes > 500 || maximumDepth > 12) break;
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (current.value && typeof current.value === 'object') {
      for (const item of Object.values(current.value)) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return { nodes, maximumDepth };
}

function recordStrike(req: Request, statusCode: number) {
  if (!SIGNAL_STATUSES.has(statusCode)) return;
  const key = clientKey(req);
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { strikes: 0, resetAt: now + apiSecurityConfig.abuseWindowMs }
    : current;
  bucket.strikes += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
      if (buckets.size <= 9_000) break;
    }
  }
}

function rejectAbuse(req: Request, reason: string, message: string, statusCode = 400) {
  logger.warn({ event: 'security.api_abuse_detected', reason, requestId: req.requestId }, 'Potential API abuse blocked');
  return new ApiError(statusCode, message, { code: 'API_ABUSE_DETECTED', reason });
}

export function apiAbuseDetection(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const bucket = buckets.get(clientKey(req));
  if (bucket && bucket.resetAt > now && bucket.strikes >= apiSecurityConfig.abuseStrikeLimit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.setHeader('X-Abuse-Detection', 'blocked');
    return next(rejectAbuse(req, 'repeated_security_failures', 'API access temporarily blocked due to suspicious activity', 429));
  }
  if (req.originalUrl.length > 8_192) return next(rejectAbuse(req, 'url_too_long', 'Request URL is too long', 414));
  if (req.rawHeaders.length / 2 > 100) return next(rejectAbuse(req, 'excessive_headers', 'Too many request headers', 431));
  if (req.get('x-http-method-override')) return next(rejectAbuse(req, 'method_override', 'HTTP method override is not supported'));
  if (Object.keys(req.query).length > 50) return next(rejectAbuse(req, 'query_parameter_flood', 'Too many query parameters'));

  const complexity = payloadComplexity(req.body);
  if (complexity.maximumDepth > 12 || complexity.nodes > 500) {
    return next(rejectAbuse(req, 'payload_complexity', 'Request payload is too complex'));
  }

  res.once('finish', () => recordStrike(req, res.statusCode));
  return next();
}
