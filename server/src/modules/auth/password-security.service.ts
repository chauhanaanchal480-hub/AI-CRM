import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { isProd } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { verifyPassword } from '../../utils/password.js';

const PASSWORD_HISTORY_DEPTH = 5;
const OFFLINE_BREACHED_SHA1 = new Set([
  '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8', // password
  '7C4A8D09CA3762AF61E59520943DC26494F8941B', // 123456
  'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', // letmein
  'B1B3773A05C0ED0176787A4F1574FF0075F7521E', // qwerty
  '49EFEF5F70D47ADC2DB2EB397FBEF5F7BC560E29', // Password123!
]);
const hibpCache = new Map<string, { expiresAt: number; suffixes: Set<string> }>();

function sha1(value: string) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

async function hibpContains(hash: string): Promise<boolean> {
  if (!isProd) return false;
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const cached = hibpCache.get(prefix);
  if (cached && cached.expiresAt > Date.now()) return cached.suffixes.has(suffix);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  timeout.unref();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'AI-CRM-Password-Security' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HIBP returned ${response.status}`);
    const suffixes = new Set(
      (await response.text())
        .split(/\r?\n/)
        .map((line) => line.split(':', 1)[0]?.trim().toUpperCase())
        .filter((value): value is string => Boolean(value)),
    );
    if (hibpCache.size >= 1_000) hibpCache.delete(hibpCache.keys().next().value ?? '');
    hibpCache.set(prefix, { expiresAt: Date.now() + 60 * 60 * 1000, suffixes });
    return suffixes.has(suffix);
  } catch (error) {
    logger.warn(
      { event: 'security.password_breach_check_unavailable', errorName: error instanceof Error ? error.name : typeof error },
      'Password breach service unavailable; offline checks remain active',
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const passwordSecurityService = {
  async assertAllowed(userId: string | null, password: string) {
    const hash = sha1(password);
    if (OFFLINE_BREACHED_SHA1.has(hash) || await hibpContains(hash)) {
      throw ApiError.badRequest('This password appears in a known data breach. Choose a different password.');
    }
    if (!userId) return;

    const [user, history] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
      prisma.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PASSWORD_HISTORY_DEPTH,
        select: { passwordHash: true },
      }),
    ]);
    const hashes = [user?.passwordHash, ...history.map((entry) => entry.passwordHash)].filter(
      (value): value is string => Boolean(value),
    );
    for (const previousHash of [...new Set(hashes)]) {
      if (await verifyPassword(password, previousHash)) {
        throw ApiError.badRequest(`Password cannot match any of your last ${PASSWORD_HISTORY_DEPTH} passwords`);
      }
    }
  },

  async record(userId: string, passwordHash: string) {
    await prisma.passwordHistory.create({ data: { userId, passwordHash } });
    const stale = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.passwordHistory.deleteMany({ where: { id: { in: stale.map(({ id }) => id) } } });
    }
  },
};
