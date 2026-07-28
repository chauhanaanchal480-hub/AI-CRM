import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isProd } from '../../config/env.js';
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
} from './auth.validation.js';

// Stricter limiter for auth endpoints to blunt brute-force attempts.
// Relaxed outside production so e2e suites (many logins per run) don't 429.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 50 : 100000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please try again later' } },
});

// Password-reset flows get an even tighter budget: they are unauthenticated
// and each request costs a token signature / DB lookup.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isProd ? 10 : 100000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please try again later' } },
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(authController.register));
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
authRouter.post('/forgot-password', resetLimiter, validate({ body: forgotPasswordSchema }), asyncHandler(authController.forgotPassword));
authRouter.post('/reset-password', resetLimiter, validate({ body: resetPasswordSchema }), asyncHandler(authController.resetPassword));
authRouter.post('/refresh', authLimiter, validate({ body: refreshSchema }), asyncHandler(authController.refresh));
authRouter.post('/logout', authLimiter, validate({ body: refreshSchema }), asyncHandler(authController.logout));
authRouter.get('/me', authenticate, asyncHandler(authController.me));
authRouter.get('/sessions', authenticate, asyncHandler(authController.sessions));
authRouter.get('/login-history', authenticate, asyncHandler(authController.loginHistory));
authRouter.delete('/sessions/current', authenticate, asyncHandler(authController.logoutCurrent));
authRouter.post('/sessions/logout-others', authenticate, asyncHandler(authController.logoutOthers));
authRouter.post('/sessions/logout-all', authenticate, asyncHandler(authController.logoutAll));
authRouter.delete(
  '/sessions/:sessionId',
  authenticate,
  validate({ params: sessionIdParam }),
  asyncHandler(authController.logoutSelected),
);
