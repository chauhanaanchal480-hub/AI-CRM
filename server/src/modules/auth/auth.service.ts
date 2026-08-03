import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ttlToDate,
} from '../../utils/jwt.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  progressiveDelay,
} from '../../middleware/bruteForce.js';
import type { RegisterInput, LoginInput } from './auth.validation.js';
import type { User } from '@prisma/client';
import {
  sessionSecurityService,
  type SessionRequestContext,
} from './session.service.js';
import { mfaService } from './mfa.service.js';
import { passwordSecurityService } from './password-security.service.js';

// Pre-computed hash so "user not found" and "wrong password" take the same
// time — prevents email enumeration via response timing.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8ZkJcVSaOKV9pZzGnRTWuWMHyLBBSO';

function passwordVersion(passwordHash: string): string {
  return crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(passwordHash).digest('base64url');
}

function toPublicUser(user: User) {
  const { passwordHash: _ph, mfaSecretEncrypted: _mfaSecret, ...rest } = user;
  void _ph;
  void _mfaSecret;
  return rest;
}

export const authService = {
  async register(input: RegisterInput, context: SessionRequestContext) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists');
    await passwordSecurityService.assertAllowed(null, input.password);

    const isFirstUser = (await prisma.user.count()) === 0;
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        // First registered account bootstraps as ADMIN; everyone else is EMPLOYEE.
        role: isFirstUser ? 'ADMIN' : 'EMPLOYEE',
      },
    });
    await passwordSecurityService.record(user.id, passwordHash);
    const tokens = await sessionSecurityService.issueSession(user, context);
    return { user: toPublicUser(user), ...tokens };
  },

  async login(input: LoginInput, context: SessionRequestContext) {
    assertLoginAllowed(input.email, context.ip);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Always run a bcrypt compare so timing doesn't reveal whether the email exists.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !ok) {
      await sessionSecurityService.recordFailedLogin(user, input.email, context);
      const failures = recordLoginFailure(input.email, context.ip);
      await progressiveDelay(failures);
      throw ApiError.unauthorized('Invalid credentials');
    }
    recordLoginSuccess(input.email);
    const risk = await sessionSecurityService.assessLoginRisk(user.id, context);
    if (user.mfaEnabled) {
      const trustedDevice = await mfaService.resolveTrustedDevice(user.id, context, risk);
      if (!trustedDevice) return mfaService.createLoginChallenge(user, context, risk);
      const tokens = await sessionSecurityService.issueSession(user, context, {
        risk,
        trustedDeviceId: trustedDevice.id,
      });
      logger.info(
        { event: 'auth.login_succeeded', userId: user.id, sessionId: tokens.sessionId, trustedDevice: true },
        'Login succeeded with a trusted device',
      );
      return { user: toPublicUser(user), ...tokens };
    }
    if (risk.level === 'HIGH') {
      logger.warn(
        { event: 'security.login_blocked_high_risk', userId: user.id, reasons: risk.reasons },
        'High-risk login blocked because the account has no MFA factor',
      );
      throw new ApiError(403, 'This login was blocked because it appears suspicious. Use a known device or contact an administrator.', {
        code: 'HIGH_RISK_LOGIN_BLOCKED',
        risk: { level: risk.level, reasons: risk.reasons },
      });
    }
    const tokens = await sessionSecurityService.issueSession(user, context, { risk });
    logger.info(
      { event: 'auth.login_succeeded', userId: user.id, sessionId: tokens.sessionId },
      'Login succeeded',
    );
    return { user: toPublicUser(user), ...tokens };
  },

  /**
   * Always responds identically whether or not the email exists (no
   * enumeration). When the account exists, a short-lived single-use reset
   * token is minted; delivery would go through an email provider.
   */
  async forgotPassword(email: string, ip = 'unknown') {
    const user = await prisma.user.findUnique({ where: { email } });
    logger.info({ event: 'auth.password_reset_requested', email, ip }, 'Password reset requested');
    if (user && user.isActive) {
      const resetToken = jwt.sign(
        { sub: user.id, purpose: 'password_reset', version: passwordVersion(user.passwordHash) },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', expiresIn: '15m' },
      );
      // Without an email provider we log only the event — never the token.
      void resetToken;
    }
    return { message: 'If an account with this email exists, a reset link has been sent.' };
  },

  async resetPassword(token: string, password: string, ip = 'unknown') {
    let payload: { sub: string; purpose?: string; version?: string };
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as {
        sub: string;
        purpose?: string;
        version?: string;
      };
    } catch {
      throw ApiError.badRequest('Reset link is invalid or has expired');
    }
    if (payload.purpose !== 'password_reset' || typeof payload.sub !== 'string' || typeof payload.version !== 'string') {
      throw ApiError.badRequest('Reset link is invalid or has expired');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || payload.version !== passwordVersion(user.passwordHash)) {
      throw ApiError.badRequest('Reset link is invalid or has expired');
    }

    await passwordSecurityService.assertAllowed(user.id, password);
    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await passwordSecurityService.record(user.id, passwordHash);
    // Invalidate every existing session after a reset.
    await sessionSecurityService.revokeAll(user.id);
    logger.info({ event: 'auth.password_reset_completed', userId: user.id, ip }, 'Password reset completed');
    return { message: 'Password has been reset' };
  },

  async refresh(token: string | undefined, context: SessionRequestContext) {
    if (!token) throw ApiError.unauthorized('Missing refresh token');
    let payload: { sub: string; sid: string };
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Reuse of a rotated token signals theft: kill every active session.
      if (stored?.revokedAt) {
        await sessionSecurityService.revokeAll(stored.userId);
        logger.warn(
          { event: 'auth.refresh_reuse', userId: stored.userId },
          'Revoked refresh token reused — all sessions invalidated',
        );
      }
      throw ApiError.unauthorized('Refresh token expired or revoked');
    }
    if (payload.sub !== stored.userId || payload.sid !== stored.sessionId) {
      await sessionSecurityService.revokeAll(stored.userId);
      logger.warn({ event: 'auth.refresh_subject_mismatch', userId: stored.userId }, 'Refresh token subject mismatch');
      throw ApiError.unauthorized('Invalid refresh token');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw ApiError.unauthorized('Account unavailable');
    const session = await sessionSecurityService.activeRefreshSession(user.id, payload.sid, context);
    if (!session) throw ApiError.unauthorized('Session expired or revoked');

    // Revoke-and-replace is atomic so concurrent refreshes cannot mint two
    // valid successors or strand a session if token creation fails.
    const now = new Date();
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: session.sessionId,
    });
    const refreshToken = signRefreshToken(user.id, session.sessionId);
    const refreshExpiresAt = new Date(
      Math.min(ttlToDate(env.JWT_REFRESH_TTL).getTime(), session.absoluteExpiresAt.getTime()),
    );
    const rotated = await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          sessionId: session.sessionId,
          expiresAt: refreshExpiresAt,
        },
      });
      return true;
    });
    if (!rotated) {
      await sessionSecurityService.revokeAll(user.id);
      logger.warn({ event: 'auth.refresh_race_or_reuse', userId: user.id }, 'Refresh rotation conflict');
      throw ApiError.unauthorized('Refresh token expired or revoked');
    }
    await sessionSecurityService.touchAfterRefresh(session);
    return { user: toPublicUser(user), accessToken, refreshToken };
  },

  async logout(token: string | undefined) {
    if (!token) return;
    const stored = await prisma.refreshToken.findUnique({ where: { token }, select: { userId: true } });
    if (!stored) return;
    const revokedSessions = await sessionSecurityService.revokeAll(stored.userId);
    logger.info(
      { event: 'auth.logout_all_sessions', userId: stored.userId, revokedSessions },
      'Logout invalidated active refresh tokens',
    );
  },

  async verifyMfaLogin(
    challengeToken: string,
    code: string,
    rememberDevice: boolean,
    context: SessionRequestContext,
  ) {
    const result = await mfaService.completeLogin(challengeToken, code, rememberDevice, context);
    const { user, ...tokens } = result;
    logger.info(
      { event: 'auth.login_succeeded', userId: user.id, sessionId: tokens.sessionId, mfa: true },
      'Login succeeded with MFA',
    );
    return { user: toPublicUser(user), ...tokens };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    return toPublicUser(user);
  },
};
