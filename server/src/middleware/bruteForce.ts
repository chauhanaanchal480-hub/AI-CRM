import { ApiError } from '../utils/ApiError.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

/**
 * In-memory brute-force / credential-stuffing guard for the login endpoint.
 * Tracks failures per account and per source IP with a sliding window,
 * applies a progressive delay to each failure, and temporarily locks out
 * keys that exceed the threshold.
 */
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_ACCOUNT = 5;
// Per-IP threshold is intentionally higher: it catches credential stuffing
// (many accounts, one source) without tripping shared NATs too eagerly.
const MAX_ATTEMPTS_PER_IP = isProd ? 30 : 1000;
const DELAY_STEP_MS = isProd ? 250 : 25;
const DELAY_MAX_MS = isProd ? 2000 : 150;

interface Entry {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

function getEntry(key: string): Entry {
  const now = Date.now();
  let entry = entries.get(key);
  if (!entry || (now - entry.windowStart > WINDOW_MS && entry.lockedUntil <= now)) {
    entry = { count: 0, windowStart: now, lockedUntil: 0 };
    entries.set(key, entry);
  }
  return entry;
}

function prune() {
  if (entries.size < 10_000) return;
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now - entry.windowStart > WINDOW_MS && entry.lockedUntil <= now) entries.delete(key);
  }
}

const emailKey = (email: string) => `acct:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;

/** Throws 429 when the account or source IP is currently locked out. */
export function assertLoginAllowed(email: string, ip: string) {
  const now = Date.now();
  for (const key of [emailKey(email), ipKey(ip)]) {
    const entry = entries.get(key);
    if (entry && entry.lockedUntil > now) {
      throw new ApiError(429, 'Too many failed attempts. Please try again later.');
    }
  }
}

/** Records a failed attempt, locking the key when the threshold is crossed. */
export function recordLoginFailure(email: string, ip: string) {
  prune();
  const now = Date.now();
  logger.warn({ event: 'auth.login_failed', email, ip }, 'Failed login attempt');

  const acct = getEntry(emailKey(email));
  acct.count += 1;
  if (acct.count >= MAX_ATTEMPTS_PER_ACCOUNT && acct.lockedUntil <= now) {
    acct.lockedUntil = now + LOCK_MS;
    logger.warn({ event: 'auth.account_locked', email, ip }, 'Account temporarily locked after repeated failures');
  }

  const src = getEntry(ipKey(ip));
  src.count += 1;
  if (src.count >= MAX_ATTEMPTS_PER_IP && src.lockedUntil <= now) {
    src.lockedUntil = now + LOCK_MS;
    logger.warn({ event: 'auth.ip_locked', ip }, 'Source IP temporarily locked: possible credential stuffing');
  }

  return acct.count;
}

/** Clears the account's failure counter after a successful login. */
export function recordLoginSuccess(email: string) {
  entries.delete(emailKey(email));
}

/** Progressive delay: each consecutive failure slows the next response. */
export function progressiveDelay(failureCount: number): Promise<void> {
  const ms = Math.min(failureCount * DELAY_STEP_MS, DELAY_MAX_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
