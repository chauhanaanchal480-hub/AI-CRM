import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { authService } from './auth.service.js';
import { sessionSecurityService } from './session.service.js';
import { mfaService } from './mfa.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { isProd } from '../../config/env.js';

const REFRESH_COOKIE = 'refreshToken';
const DEVICE_COOKIE = 'deviceId';
const TRUSTED_DEVICE_COOKIE = 'trustedDevice';
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const deviceCookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 365 * 24 * 60 * 60 * 1000,
  signed: true,
};

const trustedDeviceCookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  signed: true,
};

function sessionContext(req: Request, res: Response) {
  const signedDeviceId = req.signedCookies?.[DEVICE_COOKIE];
  const legacyDeviceId = req.cookies?.[DEVICE_COOKIE];
  const existing = typeof signedDeviceId === 'string' ? signedDeviceId : legacyDeviceId;
  const deviceId = typeof existing === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
    ? existing
    : crypto.randomUUID();
  if (deviceId !== signedDeviceId) res.cookie(DEVICE_COOKIE, deviceId, deviceCookieOpts);
  const signedTrustedDevice = req.signedCookies?.[TRUSTED_DEVICE_COOKIE];
  const legacyTrustedDevice = req.cookies?.[TRUSTED_DEVICE_COOKIE];
  const trustedDeviceToken = typeof signedTrustedDevice === 'string'
    ? signedTrustedDevice
    : typeof legacyTrustedDevice === 'string' ? legacyTrustedDevice : undefined;
  if (trustedDeviceToken && trustedDeviceToken !== signedTrustedDevice) {
    res.cookie(TRUSTED_DEVICE_COOKIE, trustedDeviceToken, trustedDeviceCookieOpts);
  }
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.get('user-agent') ?? 'unknown',
    deviceId,
    trustedDeviceToken,
    acceptLanguage: req.get('accept-language'),
    clientUa: req.get('sec-ch-ua'),
    clientPlatform: req.get('sec-ch-ua-platform'),
    clientMobile: req.get('sec-ch-ua-mobile'),
  };
}

export const authController = {
  async register(req: Request, res: Response) {
    const result = await authService.register(req.body, sessionContext(req, res));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    return sendSuccess(res, result, 201);
  },

  async login(req: Request, res: Response) {
    const result = await authService.login(req.body, sessionContext(req, res));
    if ('refreshToken' in result) res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    return sendSuccess(res, result);
  },

  async verifyMfaLogin(req: Request, res: Response) {
    const result = await authService.verifyMfaLogin(
      req.body.challengeToken,
      req.body.code,
      req.body.rememberDevice,
      sessionContext(req, res),
    );
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    if (result.trustedDeviceToken) {
      res.cookie(TRUSTED_DEVICE_COOKIE, result.trustedDeviceToken, trustedDeviceCookieOpts);
    }
    const { trustedDeviceToken: _trustedDeviceToken, ...response } = result;
    void _trustedDeviceToken;
    return sendSuccess(res, response);
  },

  async forgotPassword(req: Request, res: Response) {
    const result = await authService.forgotPassword(req.body.email, req.ip ?? 'unknown');
    return sendSuccess(res, result);
  },

  async resetPassword(req: Request, res: Response) {
    const result = await authService.resetPassword(req.body.token, req.body.password, req.ip ?? 'unknown');
    return sendSuccess(res, result);
  },

  async refresh(req: Request, res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    const result = await authService.refresh(token, sessionContext(req, res));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    return sendSuccess(res, result);
  },

  async logout(req: Request, res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    await authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
    return sendSuccess(res, { message: 'Logged out' });
  },

  async me(req: Request, res: Response) {
    const user = await authService.me(req.user!.sub);
    return sendSuccess(res, user);
  },

  async sessions(req: Request, res: Response) {
    const sessions = await sessionSecurityService.listActive(req.user!.sub, req.user!.sid);
    return sendSuccess(res, sessions);
  },

  async loginHistory(req: Request, res: Response) {
    const history = await sessionSecurityService.loginHistory(req.user!.sub);
    return sendSuccess(res, history);
  },

  async logoutCurrent(req: Request, res: Response) {
    await sessionSecurityService.revokeSelected(req.user!.sub, req.user!.sid);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
    return sendSuccess(res, { message: 'Current session logged out' });
  },

  async logoutSelected(req: Request, res: Response) {
    await sessionSecurityService.revokeSelected(req.user!.sub, req.params.sessionId);
    if (req.params.sessionId === req.user!.sid) {
      res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
    }
    return sendSuccess(res, { message: 'Session logged out' });
  },

  async logoutOthers(req: Request, res: Response) {
    const revokedSessions = await sessionSecurityService.revokeOthers(req.user!.sub, req.user!.sid);
    return sendSuccess(res, { message: 'Other sessions logged out', revokedSessions });
  },

  async logoutAll(req: Request, res: Response) {
    const revokedSessions = await sessionSecurityService.revokeAll(req.user!.sub);
    res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
    return sendSuccess(res, { message: 'All sessions logged out', revokedSessions });
  },

  async mfaStatus(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.status(req.user!.sub));
  },

  async mfaSetup(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.beginSetup(req.user!.sub, req.user!.email));
  },

  async mfaEnable(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.enable(req.user!.sub, req.body.code));
  },

  async mfaDisable(req: Request, res: Response) {
    const result = await mfaService.disable(req.user!.sub, req.user!.sid, req.body.code);
    res.clearCookie(TRUSTED_DEVICE_COOKIE, { ...trustedDeviceCookieOpts, maxAge: undefined });
    return sendSuccess(res, result);
  },

  async recoveryCodes(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.regenerateRecoveryCodes(req.user!.sub, req.body.code));
  },

  async trustedDevices(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.listTrustedDevices(req.user!.sub));
  },

  async revokeTrustedDevice(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.revokeTrustedDevice(req.user!.sub, req.params.trustedDeviceId));
  },

  async stepUp(req: Request, res: Response) {
    return sendSuccess(res, await mfaService.stepUp(
      req.user!.sub,
      req.user!.sid,
      req.body.password,
      req.body.code,
    ));
  },
};
