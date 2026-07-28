import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  sid: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function signRefreshToken(userId: string, sessionId: string): string {
  // jti makes every token unique even for same-second logins by the same
  // user; without it the JWT bytes collide and violate the DB unique index.
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_REFRESH_TTL,
    jwtid: crypto.randomUUID(),
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.sid !== 'string'
    || !['ADMIN', 'SALES_MANAGER', 'EMPLOYEE'].includes(payload.role)) {
    throw new jwt.JsonWebTokenError('Invalid access token payload');
  }
  return payload;
}

export function verifyRefreshToken(token: string): { sub: string; sid: string } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as {
    sub?: unknown;
    sid?: unknown;
  };
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new jwt.JsonWebTokenError('Invalid refresh token payload');
  }
  return { sub: payload.sub, sid: payload.sid };
}

/** Convert a `jsonwebtoken`-style TTL (e.g. "7d") to an absolute expiry date. */
export function ttlToDate(ttl: string): Date {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  const now = Date.now();
  if (!match) return new Date(now + 7 * 24 * 60 * 60 * 1000);
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return new Date(now + value * multipliers[unit]);
}

export function ttlToMilliseconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return Number(match[1]) * multipliers[match[2]];
}
