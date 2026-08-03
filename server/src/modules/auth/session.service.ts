import crypto from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  signAccessToken,
  signRefreshToken,
  ttlToDate,
  ttlToMilliseconds,
} from '../../utils/jwt.js';

export interface SessionRequestContext {
  ip: string;
  userAgent: string;
  deviceId: string;
  trustedDeviceToken?: string;
  acceptLanguage?: string;
  clientUa?: string;
  clientPlatform?: string;
  clientMobile?: string;
}

export type LoginRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LoginRiskAssessment {
  level: LoginRiskLevel;
  reasons: string[];
  knownDevice: boolean;
  knownIp: boolean;
}

interface IssueSessionOptions {
  risk?: LoginRiskAssessment;
  mfaVerified?: boolean;
  trustedDeviceId?: string;
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
let lastCleanupAt = 0;

function bounded(value: string | undefined, max: number, fallback: string) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : fallback;
}

function browserFrom(userAgent: string) {
  const candidates: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari\//, 'Safari'],
  ];
  for (const [pattern, name] of candidates) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  return 'Unknown';
}

function operatingSystemFrom(userAgent: string) {
  if (/Windows NT 10\.0/i.test(userAgent)) return 'Windows 10/11';
  if (/Windows/i.test(userAgent)) return 'Windows';
  const ios = /(?:iPhone OS|CPU OS) ([\d_]+)/i.exec(userAgent);
  if (ios) return `iOS ${ios[1].replace(/_/g, '.')}`;
  const android = /Android ([\d.]+)/i.exec(userAgent);
  if (android) return `Android ${android[1]}`;
  const mac = /Mac OS X ([\d_]+)/i.exec(userAgent);
  if (mac) return `macOS ${mac[1].replace(/_/g, '.')}`;
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function deviceTypeFrom(userAgent: string) {
  if (/iPad|Tablet/i.test(userAgent)) return 'Tablet';
  if (/Mobile|iPhone|Android/i.test(userAgent)) return 'Mobile';
  return 'Desktop';
}

export function describeSessionContext(context: SessionRequestContext) {
  const ip = bounded(context.ip, 64, 'unknown');
  const userAgent = bounded(context.userAgent, 512, 'unknown');
  const deviceId = bounded(context.deviceId, 128, 'unknown');
  const browser = browserFrom(userAgent);
  const operatingSystem = operatingSystemFrom(userAgent);
  const deviceType = deviceTypeFrom(userAgent);
  const fingerprintSignals = {
    version: 2,
    deviceId,
    browser: browser.split(' ', 1)[0],
    operatingSystem: operatingSystem.split(' ', 1)[0],
    deviceType,
    language: bounded(context.acceptLanguage, 64, 'unknown').split(',', 1)[0].toLowerCase(),
    clientUa: bounded(context.clientUa, 160, 'unknown').toLowerCase(),
    clientPlatform: bounded(context.clientPlatform, 64, 'unknown').toLowerCase(),
    clientMobile: bounded(context.clientMobile, 16, 'unknown').toLowerCase(),
  };
  return {
    ip,
    userAgent,
    deviceFingerprint: crypto
      .createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(JSON.stringify(fingerprintSignals))
      .digest('hex'),
    browser,
    operatingSystem,
    deviceType,
  };
}

function hashEmail(email: string) {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(email.trim().toLowerCase()).digest('hex');
}

function sessionDates(now = new Date()) {
  const absoluteExpiresAt = new Date(now.getTime() + ttlToMilliseconds(env.SESSION_ABSOLUTE_TTL));
  const idleExpiresAt = new Date(now.getTime() + ttlToMilliseconds(env.SESSION_IDLE_TTL));
  return {
    absoluteExpiresAt,
    expiresAt: new Date(Math.min(idleExpiresAt.getTime(), absoluteExpiresAt.getTime())),
  };
}

function isActive(session: Pick<Session, 'revokedAt' | 'expiresAt' | 'absoluteExpiresAt'>, now: Date) {
  return !session.revokedAt && session.expiresAt > now && session.absoluteExpiresAt > now;
}

async function cleanupExpiredSessions(now = new Date()) {
  if (now.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  const expiredWhere = {
    revokedAt: null,
    OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }],
  };
  try {
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: { revokedAt: null, session: { is: expiredWhere } },
        data: { revokedAt: now },
      }),
      prisma.session.updateMany({ where: expiredWhere, data: { revokedAt: now } }),
    ]);
    lastCleanupAt = now.getTime();
  } catch (error) {
    logger.error(
      { event: 'auth.session_cleanup_failed', errorName: error instanceof Error ? error.name : typeof error },
      'Expired session cleanup failed',
    );
    throw error;
  }
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredSessions().catch(() => undefined);
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

async function revokeOwnedSessions(userId: string, sessionIds: string[], now = new Date()) {
  if (sessionIds.length === 0) return 0;
  const [sessions] = await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, sessionId: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, sessionId: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  return sessions.count;
}

export const sessionSecurityService = {
  async assessLoginRisk(userId: string, context: SessionRequestContext): Promise<LoginRiskAssessment> {
    const now = new Date();
    const device = describeSessionContext(context);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const [previousSuccess, knownDevice, knownIp, recentFailures, recentSuccesses] = await Promise.all([
      prisma.loginHistory.findFirst({
        where: { userId, success: true },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      prisma.session.findFirst({
        where: { userId, deviceFingerprint: device.deviceFingerprint },
        select: { sessionId: true },
      }),
      prisma.loginHistory.findFirst({
        where: { userId, success: true, ip: device.ip },
        select: { id: true },
      }),
      prisma.loginHistory.count({
        where: { userId, success: false, timestamp: { gte: oneHourAgo } },
      }),
      prisma.loginHistory.count({
        where: { userId, success: true, timestamp: { gte: tenMinutesAgo } },
      }),
    ]);

    if (!previousSuccess) return { level: 'LOW', reasons: [], knownDevice: false, knownIp: false };
    const reasons: string[] = [];
    if (!knownDevice) reasons.push('NEW_DEVICE');
    if (!knownIp) reasons.push('NEW_IP');
    if (recentFailures >= 3) reasons.push('RECENT_FAILED_LOGINS');
    if (recentSuccesses >= 5) reasons.push('HIGH_LOGIN_VELOCITY');
    const level: LoginRiskLevel = reasons.includes('RECENT_FAILED_LOGINS')
      || (reasons.includes('HIGH_LOGIN_VELOCITY') && !knownIp)
      || (reasons.includes('NEW_DEVICE') && reasons.includes('NEW_IP'))
      ? 'HIGH'
      : reasons.length > 0 ? 'MEDIUM' : 'LOW';
    return { level, reasons, knownDevice: Boolean(knownDevice), knownIp: Boolean(knownIp) };
  },

  async issueSession(user: User, context: SessionRequestContext, options: IssueSessionOptions = {}) {
    await cleanupExpiredSessions();
    const now = new Date();
    const sessionId = crypto.randomUUID();
    const device = describeSessionContext(context);
    const { expiresAt, absoluteExpiresAt } = sessionDates(now);
    const refreshExpiresAt = new Date(
      Math.min(ttlToDate(env.JWT_REFRESH_TTL).getTime(), absoluteExpiresAt.getTime()),
    );
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
    });
    const refreshToken = signRefreshToken(user.id, sessionId);
    const risk = options.risk ?? await this.assessLoginRisk(user.id, context);
    const activeSessionCount = await prisma.session.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
    });

    await prisma.$transaction([
      prisma.session.create({
        data: {
          sessionId,
          userId: user.id,
          issuedAt: now,
          expiresAt,
          absoluteExpiresAt,
          lastActivity: now,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          mfaVerifiedAt: options.mfaVerified ? now : null,
          stepUpVerifiedAt: now,
          trustedDeviceId: options.trustedDeviceId,
          ...device,
        },
      }),
      prisma.refreshToken.create({
        data: { token: refreshToken, userId: user.id, sessionId, expiresAt: refreshExpiresAt },
      }),
      prisma.loginHistory.create({
        data: {
          userId: user.id,
          emailHash: hashEmail(user.email),
          success: true,
          timestamp: now,
          sessionId,
          ...device,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { previousLoginAt: user.currentLoginAt, currentLoginAt: now },
      }),
    ]);

    if (!risk.knownDevice && risk.reasons.includes('NEW_DEVICE')) {
      logger.warn({ event: 'security.login_new_device', userId: user.id, sessionId }, 'Login from a new device');
    }
    if (!risk.knownIp && risk.reasons.includes('NEW_IP')) {
      logger.warn({ event: 'security.login_new_ip', userId: user.id, sessionId }, 'Login from a new IP');
    }
    if (activeSessionCount > 0) {
      logger.warn(
        { event: 'security.login_concurrent_sessions', userId: user.id, sessionId, activeSessions: activeSessionCount + 1 },
        'Multiple concurrent sessions detected',
      );
    }
    if (risk.level === 'HIGH') {
      logger.warn(
        { event: 'security.login_high_risk', userId: user.id, sessionId, reasons: risk.reasons },
        'High-risk login detected',
      );
    }

    return { accessToken, refreshToken, sessionId, risk: { level: risk.level, reasons: risk.reasons } };
  },

  async stepUpIsCurrent(userId: string, sessionId: string, maxAgeMs: number) {
    const session = await prisma.session.findFirst({
      where: { userId, sessionId, revokedAt: null },
      select: { stepUpVerifiedAt: true },
    });
    return Boolean(session?.stepUpVerifiedAt && Date.now() - session.stepUpVerifiedAt.getTime() <= maxAgeMs);
  },

  async markStepUp(userId: string, sessionId: string, mfaVerified: boolean) {
    const now = new Date();
    const updated = await prisma.session.updateMany({
      where: { userId, sessionId, revokedAt: null },
      data: { stepUpVerifiedAt: now, ...(mfaVerified ? { mfaVerifiedAt: now } : {}) },
    });
    if (updated.count !== 1) throw ApiError.unauthorized('Session expired or revoked');
    return now;
  },

  async recordFailedLogin(user: User | null, email: string, context: SessionRequestContext) {
    const now = new Date();
    const device = describeSessionContext(context);
    await prisma.$transaction([
      prisma.loginHistory.create({
        data: {
          userId: user?.id,
          emailHash: hashEmail(email),
          success: false,
          timestamp: now,
          ...device,
        },
      }),
      ...(user
        ? [prisma.user.update({ where: { id: user.id }, data: { lastFailedLoginAt: now } })]
        : []),
    ]);
  },

  async validateAccessSession(userId: string, sessionId: string) {
    await cleanupExpiredSessions();
    const now = new Date();
    const session = await prisma.session.findUnique({ where: { sessionId } });
    if (!session || session.userId !== userId || !isActive(session, now)) {
      if (session?.userId === userId && !session.revokedAt) {
        await revokeOwnedSessions(userId, [sessionId], now);
      }
      return false;
    }
    if (now.getTime() - session.lastActivity.getTime() >= ACTIVITY_WRITE_INTERVAL_MS) {
      const nextExpiry = new Date(
        Math.min(now.getTime() + ttlToMilliseconds(env.SESSION_IDLE_TTL), session.absoluteExpiresAt.getTime()),
      );
      await prisma.session.updateMany({
        where: { sessionId, userId, revokedAt: null },
        data: { lastActivity: now, expiresAt: nextExpiry },
      });
    }
    return true;
  },

  async activeRefreshSession(userId: string, sessionId: string, context: SessionRequestContext) {
    await cleanupExpiredSessions();
    const now = new Date();
    const session = await prisma.session.findUnique({ where: { sessionId } });
    if (!session || session.userId !== userId || !isActive(session, now)) return null;
    const device = describeSessionContext(context);
    if (session.ip !== device.ip || session.deviceFingerprint !== device.deviceFingerprint) {
      logger.warn(
        { event: 'security.session_context_changed', userId, sessionId },
        'Refresh attempted from a changed device or network context',
      );
    }
    return session;
  },

  async touchAfterRefresh(session: Session) {
    const now = new Date();
    const expiresAt = new Date(
      Math.min(now.getTime() + ttlToMilliseconds(env.SESSION_IDLE_TTL), session.absoluteExpiresAt.getTime()),
    );
    await prisma.session.updateMany({
      where: { sessionId: session.sessionId, revokedAt: null },
      data: { lastActivity: now, expiresAt },
    });
    return expiresAt;
  },

  async listActive(userId: string, currentSessionId: string) {
    await cleanupExpiredSessions();
    const now = new Date();
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: { lastActivity: 'desc' },
    });
    return sessions.map((session) => ({
      sessionId: session.sessionId,
      current: session.sessionId === currentSessionId,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastActivity: session.lastActivity,
      ip: session.ip,
      browser: session.browser,
      operatingSystem: session.operatingSystem,
      deviceType: session.deviceType,
      riskLevel: session.riskLevel,
      riskReasons: session.riskReasons,
      mfaVerifiedAt: session.mfaVerifiedAt,
      trusted: Boolean(session.trustedDeviceId),
      location: null,
    }));
  },

  async loginHistory(userId: string) {
    const [user, history] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { currentLoginAt: true, previousLoginAt: true, lastFailedLoginAt: true },
      }),
      prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: 100,
        select: {
          id: true,
          success: true,
          timestamp: true,
          ip: true,
          browser: true,
          operatingSystem: true,
          deviceType: true,
          sessionId: true,
        },
      }),
    ]);
    if (!user) throw ApiError.notFound('User not found');
    return {
      metadata: {
        currentLogin: user.currentLoginAt,
        previousSuccessfulLogin: user.previousLoginAt,
        lastFailedLogin: user.lastFailedLoginAt,
      },
      history,
    };
  },

  async revokeSelected(userId: string, sessionId: string) {
    const session = await prisma.session.findFirst({ where: { userId, sessionId }, select: { sessionId: true } });
    if (!session) throw ApiError.notFound('Session not found');
    const count = await revokeOwnedSessions(userId, [sessionId]);
    logger.info({ event: 'auth.session_revoked', userId, sessionId }, 'Session revoked');
    return count;
  },

  async revokeOthers(userId: string, currentSessionId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId, sessionId: { not: currentSessionId }, revokedAt: null },
      select: { sessionId: true },
    });
    const count = await revokeOwnedSessions(userId, sessions.map(({ sessionId }) => sessionId));
    logger.info({ event: 'auth.other_sessions_revoked', userId, revokedSessions: count }, 'Other sessions revoked');
    return count;
  },

  async revokeAll(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { sessionId: true },
    });
    const count = await revokeOwnedSessions(userId, sessions.map(({ sessionId }) => sessionId));
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.info({ event: 'auth.all_sessions_revoked', userId, revokedSessions: count }, 'All sessions revoked');
    return count;
  },
};
