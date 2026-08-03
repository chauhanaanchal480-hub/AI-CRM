import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  sessionIdParam,
  mfaVerifySchema,
  mfaCodeBodySchema,
  stepUpSchema,
  trustedDeviceIdParam,
} from './auth.validation.js';
import {
  authRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter,
} from '../../middleware/rateLimit.js';
import { requireStepUp } from '../../middleware/requireStepUp.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validate({ body: registerSchema }), asyncHandler(authController.register));
authRouter.post('/login', loginRateLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
authRouter.post('/mfa/verify', loginRateLimiter, validate({ body: mfaVerifySchema }), asyncHandler(authController.verifyMfaLogin));
authRouter.post('/forgot-password', passwordResetRateLimiter, validate({ body: forgotPasswordSchema }), asyncHandler(authController.forgotPassword));
authRouter.post('/reset-password', passwordResetRateLimiter, validate({ body: resetPasswordSchema }), asyncHandler(authController.resetPassword));
authRouter.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), asyncHandler(authController.refresh));
authRouter.post('/logout', authRateLimiter, validate({ body: refreshSchema }), asyncHandler(authController.logout));
authRouter.get('/me', authenticate, asyncHandler(authController.me));
authRouter.get('/sessions', authenticate, asyncHandler(authController.sessions));
authRouter.get('/login-history', authenticate, asyncHandler(authController.loginHistory));
authRouter.delete('/sessions/current', authenticate, asyncHandler(authController.logoutCurrent));
authRouter.post('/sessions/logout-others', authenticate, requireStepUp, asyncHandler(authController.logoutOthers));
authRouter.post('/sessions/logout-all', authenticate, requireStepUp, asyncHandler(authController.logoutAll));
authRouter.delete(
  '/sessions/:sessionId',
  authenticate,
  requireStepUp,
  validate({ params: sessionIdParam }),
  asyncHandler(authController.logoutSelected),
);
authRouter.get('/mfa/status', authenticate, asyncHandler(authController.mfaStatus));
authRouter.post('/mfa/setup', authenticate, requireStepUp, asyncHandler(authController.mfaSetup));
authRouter.post('/mfa/enable', authenticate, requireStepUp, validate({ body: mfaCodeBodySchema }), asyncHandler(authController.mfaEnable));
authRouter.post('/mfa/disable', authenticate, requireStepUp, validate({ body: mfaCodeBodySchema }), asyncHandler(authController.mfaDisable));
authRouter.post('/mfa/recovery-codes', authenticate, requireStepUp, validate({ body: mfaCodeBodySchema }), asyncHandler(authController.recoveryCodes));
authRouter.get('/trusted-devices', authenticate, asyncHandler(authController.trustedDevices));
authRouter.delete(
  '/trusted-devices/:trustedDeviceId',
  authenticate,
  requireStepUp,
  validate({ params: trustedDeviceIdParam }),
  asyncHandler(authController.revokeTrustedDevice),
);
authRouter.post('/step-up', authenticate, validate({ body: stepUpSchema }), asyncHandler(authController.stepUp));
