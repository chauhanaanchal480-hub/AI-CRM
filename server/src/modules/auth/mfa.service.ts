import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { verifyPassword } from '../../utils/password.js';
import { decryptStoredSecret, encryptStoredSecret } from '../../services/secrets.service.js';
import {
  describeSessionContext,
  sessionSecurityService,
  type LoginRiskAssessment,
  type SessionRequestContext,
} from './session.service.js';
import { generateTotpSecret, totpProvisioningUri, verifyTotp } from './totp.js';

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
const MFA_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
let lastMfaCleanupAt = 0;

function credentialHash(value: string) {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(value).digest('hex');
}

function normalizedRecoveryCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateRecoveryCode() {
  const value = crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function mfaContext(userId: string) {
  return `mfa:${userId}`;
}

async function cleanupExpiredMfaChallenges(now = new Date()) {
  if (now.getTime() - lastMfaCleanupAt < MFA_CLEANUP_INTERVAL_MS) return;
  await prisma.mfaChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { consumedAt: { not: null } },
      ],
    },
  });
  lastMfaCleanupAt = now.getTime();
}

const cleanupTimer = setInterval(() => {
  void cleanupExpiredMfaChallenges().catch((error) => {
    logger.error(
      { event: 'auth.mfa_challenge_cleanup_failed', errorName: error instanceof Error ? error.name : typeof error },
      'MFA challenge cleanup failed',
    );
  });
}, MFA_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

async function recordFailedChallengeAttempt(challengeId: string): Promise<never> {
  const now = new Date();
  const updated = await prisma.mfaChallenge.updateMany({
    where: {
      id: challengeId,
      consumedAt: null,
      lockedAt: null,
      expiresAt: { gt: now },
      attemptCount: { lt: MFA_CHALLENGE_MAX_ATTEMPTS },
    },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
  });
  if (updated.count !== 1) throw ApiError.unauthorized('MFA challenge is invalid or expired');

  const challenge = await prisma.mfaChallenge.findUnique({
    where: { id: challengeId },
    select: { attemptCount: true },
  });
  if (challenge && challenge.attemptCount >= MFA_CHALLENGE_MAX_ATTEMPTS) {
    await prisma.mfaChallenge.updateMany({
      where: { id: challengeId, lockedAt: null },
      data: { lockedAt: now },
    });
    logger.warn({ event: 'auth.mfa_challenge_locked', challengeId }, 'MFA challenge locked after repeated failures');
    throw new ApiError(429, 'Too many invalid authentication codes. Start a new sign-in attempt.', {
      code: 'MFA_CHALLENGE_LOCKED',
    });
  }
  throw ApiError.unauthorized('Invalid authentication code');
}

async function verifyUserFactor(user: Pick<User, 'id' | 'mfaEnabled' | 'mfaSecretEncrypted'>, code: string) {
  if (!user.mfaEnabled || !user.mfaSecretEncrypted) throw ApiError.badRequest('MFA is not enabled');
  if (/^\d{6}$/.test(code)) {
    const secret = decryptStoredSecret(user.mfaSecretEncrypted, mfaContext(user.id));
    if (verifyTotp(secret, code)) return { method: 'totp' as const };
  } else {
    const codeHash = credentialHash(normalizedRecoveryCode(code));
    const recovery = await prisma.mfaRecoveryCode.findUnique({ where: { codeHash } });
    if (recovery && recovery.userId === user.id && !recovery.usedAt) {
      const consumed = await prisma.mfaRecoveryCode.updateMany({
        where: { id: recovery.id, userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 1) {
        logger.warn({ event: 'auth.mfa_recovery_code_used', userId: user.id }, 'MFA recovery code used');
        return { method: 'recovery_code' as const };
      }
    }
  }
  throw ApiError.unauthorized('Invalid authentication code');
}

async function issueTrustedDevice(userId: string, context: SessionRequestContext) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const device = describeSessionContext(context);
  const now = new Date();
  await prisma.trustedDevice.updateMany({
    where: { userId, deviceFingerprint: device.deviceFingerprint, revokedAt: null },
    data: { revokedAt: now },
  });
  const trustedDevice = await prisma.trustedDevice.create({
    data: {
      userId,
      tokenHash: credentialHash(rawToken),
      deviceFingerprint: device.deviceFingerprint,
      label: `${device.browser} on ${device.operatingSystem}`.slice(0, 160),
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS),
    },
  });
  return { trustedDevice, rawToken };
}

export const mfaService = {
  async status(userId: string) {
    const [user, recoveryCodesRemaining, trustedDevices] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { mfaEnabled: true, mfaEnabledAt: true },
      }),
      prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
      prisma.trustedDevice.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (!user) throw ApiError.notFound('User not found');
    return { ...user, recoveryCodesRemaining, trustedDevices };
  },

  async beginSetup(userId: string, email: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
    if (!user) throw ApiError.notFound('User not found');
    if (user.mfaEnabled) throw ApiError.conflict('MFA is already enabled');
    const secret = generateTotpSecret();
    let encryptedSecret: string;
    try {
      encryptedSecret = encryptStoredSecret(secret, mfaContext(userId));
    } catch {
      throw ApiError.internal('MFA encryption is unavailable');
    }
    await prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: encryptedSecret } });
    return { secret, provisioningUri: totpProvisioningUri(email, secret) };
  },

  async enable(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (user.mfaEnabled) throw ApiError.conflict('MFA is already enabled');
    if (!user.mfaSecretEncrypted) throw ApiError.badRequest('Start MFA setup before enabling it');
    const secret = decryptStoredSecret(user.mfaSecretEncrypted, mfaContext(user.id));
    if (!verifyTotp(secret, code)) throw ApiError.unauthorized('Invalid authentication code');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await prisma.$transaction([
      prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId,
          codeHash: credentialHash(normalizedRecoveryCode(recoveryCode)),
        })),
      }),
      prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true, mfaEnabledAt: new Date() },
      }),
    ]);
    logger.info({ event: 'auth.mfa_enabled', userId }, 'MFA enabled');
    return { recoveryCodes };
  },

  async disable(userId: string, currentSessionId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    await verifyUserFactor(user, code);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaEnabledAt: null, mfaSecretEncrypted: null },
      }),
      prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      prisma.mfaChallenge.deleteMany({ where: { userId } }),
      prisma.trustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await sessionSecurityService.revokeOthers(userId, currentSessionId);
    logger.warn({ event: 'auth.mfa_disabled', userId }, 'MFA disabled');
    return { message: 'MFA disabled' };
  },

  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    await verifyUserFactor(user, code);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await prisma.$transaction([
      prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId,
          codeHash: credentialHash(normalizedRecoveryCode(recoveryCode)),
        })),
      }),
    ]);
    return { recoveryCodes };
  },

  async createLoginChallenge(user: User, context: SessionRequestContext, risk: LoginRiskAssessment) {
    await cleanupExpiredMfaChallenges();
    const token = crypto.randomBytes(32).toString('base64url');
    const device = describeSessionContext(context);
    const now = new Date();
    await prisma.mfaChallenge.updateMany({
      where: {
        userId: user.id,
        deviceFingerprint: device.deviceFingerprint,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    await prisma.mfaChallenge.create({
      data: {
        userId: user.id,
        tokenHash: credentialHash(token),
        deviceFingerprint: device.deviceFingerprint,
        ip: device.ip,
        riskLevel: risk.level,
        riskReasons: risk.reasons,
        expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
      },
    });
    return {
      mfaRequired: true as const,
      challengeToken: token,
      methods: ['totp', 'recovery_code'] as const,
      risk: { level: risk.level, reasons: risk.reasons },
    };
  },

  async completeLogin(token: string, code: string, rememberDevice: boolean, context: SessionRequestContext) {
    const challenge = await prisma.mfaChallenge.findUnique({
      where: { tokenHash: credentialHash(token) },
      include: { user: true },
    });
    const device = describeSessionContext(context);
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()
      || challenge.deviceFingerprint !== device.deviceFingerprint) {
      throw ApiError.unauthorized('MFA challenge is invalid or expired');
    }
    if (challenge.lockedAt || challenge.attemptCount >= MFA_CHALLENGE_MAX_ATTEMPTS) {
      throw new ApiError(429, 'Too many invalid authentication codes. Start a new sign-in attempt.', {
        code: 'MFA_CHALLENGE_LOCKED',
      });
    }
    try {
      await verifyUserFactor(challenge.user, code);
    } catch (error) {
      if (error instanceof ApiError && (error.statusCode === 400 || error.statusCode === 401)) {
        return recordFailedChallengeAttempt(challenge.id);
      }
      throw error;
    }
    const consumed = await prisma.mfaChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        lockedAt: null,
        attemptCount: { lt: MFA_CHALLENGE_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw ApiError.unauthorized('MFA challenge is invalid or expired');

    const risk = {
      level: challenge.riskLevel as LoginRiskAssessment['level'],
      reasons: Array.isArray(challenge.riskReasons) ? challenge.riskReasons.filter((value): value is string => typeof value === 'string') : [],
      knownDevice: !Array.isArray(challenge.riskReasons) || !challenge.riskReasons.includes('NEW_DEVICE'),
      knownIp: !Array.isArray(challenge.riskReasons) || !challenge.riskReasons.includes('NEW_IP'),
    };
    const trusted = rememberDevice ? await issueTrustedDevice(challenge.userId, context) : null;
    const result = await sessionSecurityService.issueSession(challenge.user, context, {
      risk,
      mfaVerified: true,
      trustedDeviceId: trusted?.trustedDevice.id,
    });
    return { ...result, user: challenge.user, trustedDeviceToken: trusted?.rawToken };
  },

  async resolveTrustedDevice(userId: string, context: SessionRequestContext, risk: LoginRiskAssessment) {
    if (!context.trustedDeviceToken || risk.level === 'HIGH') return null;
    const device = describeSessionContext(context);
    const trusted = await prisma.trustedDevice.findUnique({
      where: { tokenHash: credentialHash(context.trustedDeviceToken) },
    });
    if (!trusted || trusted.userId !== userId || trusted.revokedAt || trusted.expiresAt <= new Date()
      || trusted.deviceFingerprint !== device.deviceFingerprint) return null;
    await prisma.trustedDevice.update({ where: { id: trusted.id }, data: { lastUsedAt: new Date() } });
    return trusted;
  },

  async listTrustedDevices(userId: string) {
    return prisma.trustedDevice.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  },

  async revokeTrustedDevice(userId: string, trustedDeviceId: string) {
    const updated = await prisma.trustedDevice.updateMany({
      where: { id: trustedDeviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) throw ApiError.notFound('Trusted device not found');
    await prisma.session.updateMany({
      where: { userId, trustedDeviceId, revokedAt: null },
      data: { trustedDeviceId: null },
    });
    return { message: 'Trusted device revoked' };
  },

  async stepUp(userId: string, sessionId: string, password: string | undefined, code: string | undefined) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    let mfaVerified = false;
    if (user.mfaEnabled) {
      if (!code) throw ApiError.badRequest('Authentication code is required');
      await verifyUserFactor(user, code);
      mfaVerified = true;
    } else {
      if (!password || !(await verifyPassword(password, user.passwordHash))) {
        throw ApiError.unauthorized('Current password is incorrect');
      }
    }
    const verifiedAt = await sessionSecurityService.markStepUp(userId, sessionId, mfaVerified);
    return { verifiedAt, expiresInSeconds: 600 };
  },
};
