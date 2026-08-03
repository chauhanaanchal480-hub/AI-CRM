import net from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../utils/jwt.js';

interface SlidingWindowEntry {
  timestamps: number[];
  head: number;
  lastSeen: number;
}

interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateLimitPolicy {
  name: string;
  max: number;
  windowMs: number;
  key: (req: Request) => string | undefined;
}

class SlidingWindowStore {
  private readonly entries = new Map<string, SlidingWindowEntry>();
  private operations = 0;

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  consume(key: string, limit: number, now = Date.now()): ConsumeResult {
    this.operations += 1;
    if (this.operations % 1_000 === 0) this.pruneExpired(now);

    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.pruneExpired(now);
      if (this.entries.size >= this.maxKeys) {
        return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
      }
      entry = { timestamps: [], head: 0, lastSeen: now };
      this.entries.set(key, entry);
    }

    this.pruneEntry(entry, now);
    entry.lastSeen = now;
    const count = entry.timestamps.length - entry.head;
    if (count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, entry.timestamps[entry.head] + this.windowMs - now),
      };
    }

    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - count - 1,
      retryAfterMs: Math.max(1, entry.timestamps[entry.head] + this.windowMs - now),
    };
  }

  private pruneEntry(entry: SlidingWindowEntry, now: number) {
    const cutoff = now - this.windowMs;
    while (entry.head < entry.timestamps.length && entry.timestamps[entry.head] <= cutoff) {
      entry.head += 1;
    }
    if (entry.head > 128 && entry.head * 2 >= entry.timestamps.length) {
      entry.timestamps = entry.timestamps.slice(entry.head);
      entry.head = 0;
    }
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      this.pruneEntry(entry, now);
      if (entry.head === entry.timestamps.length && now - entry.lastSeen >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const candidate = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIP(candidate) === 4) return candidate;
  if (net.isIP(candidate) !== 6) return candidate.slice(0, 128);

  const [left = '', right = ''] = candidate.toLowerCase().split('::');
  const expandSide = (side: string) => side ? side.split(':').flatMap((part) => {
    if (net.isIP(part) !== 4) return [part || '0'];
    const bytes = part.split('.').map(Number);
    return [((bytes[0] << 8) | bytes[1]).toString(16), ((bytes[2] << 8) | bytes[3]).toString(16)];
  }) : [];
  const leftParts = expandSide(left);
  const rightParts = expandSide(right);
  const fill = Math.max(0, 8 - leftParts.length - rightParts.length);
  const hextets = [...leftParts, ...Array<string>(fill).fill('0'), ...rightParts]
    .map((part) => Number.parseInt(part, 16).toString(16));
  return `${hextets.slice(0, 4).join(':')}::/64`;
}

function clientIp(req: Request) {
  return normalizeIp(req.ip ?? req.socket.remoteAddress);
}

function bearerUserId(req: Request): string | undefined {
  const authorization = req.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;
  try {
    return verifyAccessToken(authorization.slice('Bearer '.length).trim()).sub;
  } catch {
    return undefined;
  }
}

function setRateLimitHeaders(res: Response, policy: RateLimitPolicy, result: ConsumeResult) {
  const windowSeconds = Math.ceil(policy.windowMs / 1_000);
  const resetSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
  res.append('RateLimit-Policy', `${policy.name};q=${policy.max};w=${windowSeconds}`);
  res.setHeader('RateLimit-Limit', policy.max);
  res.setHeader('RateLimit-Remaining', result.remaining);
  res.setHeader('RateLimit-Reset', resetSeconds);
  res.setHeader('X-RateLimit-Scope', policy.name);
}

function createRateLimiter(policy: RateLimitPolicy): RequestHandler {
  const store = new SlidingWindowStore(policy.windowMs, env.RATE_LIMIT_MAX_KEYS);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.RATE_LIMIT_ENABLED || req.method === 'OPTIONS') return next();
    const key = policy.key(req);
    if (!key) return next();

    const result = store.consume(key, policy.max);
    setRateLimitHeaders(res, policy, result);
    if (result.allowed) return next();

    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
    res.setHeader('Retry-After', retryAfterSeconds);
    logger.warn(
      {
        event: 'security.rate_limit_exceeded',
        requestId: req.requestId,
        policy: policy.name,
        limit: policy.max,
        windowMs: policy.windowMs,
        retryAfterSeconds,
        method: req.method,
        path: req.originalUrl.split('?', 1)[0],
        ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        userId: req.user?.sub ?? bearerUserId(req),
        userAgent: req.get('user-agent') ?? 'unknown',
      },
      'Request blocked by rate limit',
    );
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
        details: { policy: policy.name, retryAfterSeconds },
      },
    });
  };
}

const ipKey = (req: Request) => clientIp(req);
const userKey = (req: Request) => req.user?.sub ?? bearerUserId(req);
const withNonProductionHeadroom = (configured: number) => isProd ? configured : Math.max(configured, 100_000);

export const globalApiRateLimiter = createRateLimiter({
  name: 'global',
  max: withNonProductionHeadroom(env.RATE_LIMIT_GLOBAL_MAX),
  windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
  key: () => 'api',
});

export const perIpRateLimiter = createRateLimiter({
  name: 'ip',
  max: withNonProductionHeadroom(env.RATE_LIMIT_IP_MAX),
  windowMs: env.RATE_LIMIT_IP_WINDOW_MS,
  key: ipKey,
});

export const perUserRateLimiter = createRateLimiter({
  name: 'user',
  max: withNonProductionHeadroom(env.RATE_LIMIT_USER_MAX),
  windowMs: env.RATE_LIMIT_USER_WINDOW_MS,
  key: userKey,
});

export const loginRateLimiter = createRateLimiter({
  name: 'login',
  max: withNonProductionHeadroom(env.RATE_LIMIT_LOGIN_MAX),
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  key: ipKey,
});

export const authRateLimiter = createRateLimiter({
  name: 'auth',
  max: withNonProductionHeadroom(env.RATE_LIMIT_LOGIN_MAX),
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  key: ipKey,
});

export const passwordResetRateLimiter = createRateLimiter({
  name: 'password-reset',
  max: withNonProductionHeadroom(env.RATE_LIMIT_PASSWORD_RESET_MAX),
  windowMs: env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS,
  key: ipKey,
});

export const aiRateLimiter = createRateLimiter({
  name: 'ai',
  max: env.RATE_LIMIT_AI_MAX,
  windowMs: env.RATE_LIMIT_AI_WINDOW_MS,
  key: userKey,
});

export const uploadRateLimiter = createRateLimiter({
  name: 'upload',
  max: env.RATE_LIMIT_UPLOAD_MAX,
  windowMs: env.RATE_LIMIT_UPLOAD_WINDOW_MS,
  key: userKey,
});

export const exportRateLimiter = createRateLimiter({
  name: 'export',
  max: env.RATE_LIMIT_EXPORT_MAX,
  windowMs: env.RATE_LIMIT_EXPORT_WINDOW_MS,
  key: userKey,
});
