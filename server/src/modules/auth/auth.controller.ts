import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { authService } from './auth.service.js';
import { sessionSecurityService } from './session.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { isProd } from '../../config/env.js';

const REFRESH_COOKIE = 'refreshToken';
const DEVICE_COOKIE = 'deviceId';
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
};

function sessionContext(req: Request, res: Response) {
  const existing = req.cookies?.[DEVICE_COOKIE];
  const deviceId = typeof existing === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
    ? existing
    : crypto.randomUUID();
  if (deviceId !== existing) res.cookie(DEVICE_COOKIE, deviceId, deviceCookieOpts);
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.get('user-agent') ?? 'unknown',
    deviceId,
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
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    return sendSuccess(res, result);
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
};
