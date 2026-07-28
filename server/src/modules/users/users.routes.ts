import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { passwordSchema } from '../auth/auth.validation.js';
import { logger } from '../../lib/logger.js';

const publicUser = {
  id: true, email: true, firstName: true, lastName: true, role: true,
  avatarUrl: true, title: true, phone: true, isActive: true, createdAt: true,
} as const;

const idParam = z.object({ id: z.string().cuid('Invalid id') });
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  title: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'SALES_MANAGER', 'EMPLOYEE']).optional(),
  isActive: z.boolean().optional(),
});

export const usersRouter = Router();
usersRouter.use(authenticate);

// Any authenticated user can list teammates (for assignment dropdowns).
usersRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: publicUser, orderBy: { firstName: 'asc' } });
    return sendSuccess(res, users);
  }),
);

// Update own profile.
usersRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.body as z.infer<typeof updateProfileSchema>;
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { ...data, avatarUrl: data.avatarUrl || null },
      select: publicUser,
    });
    return sendSuccess(res, user);
  }),
);

// Change own password.
usersRouter.post(
  '/me/password',
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      logger.warn({ event: 'auth.password_change_failed', userId: req.user!.sub }, 'Password change rejected: wrong current password');
      throw ApiError.badRequest('Current password is incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
    // Revoke refresh tokens so other sessions must re-authenticate.
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    logger.info({ event: 'auth.password_changed', userId: user.id }, 'Password changed');
    return sendSuccess(res, { message: 'Password updated' });
  }),
);

// Admin: change a user's role / activation.
usersRouter.patch(
  '/:id',
  authorize('ADMIN'),
  validate({ params: idParam, body: updateRoleSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // An admin cannot demote or deactivate their own account.
    if (req.params.id === req.user!.sub) {
      throw ApiError.forbidden('You cannot change your own role or status');
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: req.body as z.infer<typeof updateRoleSchema>,
      select: publicUser,
    });
    return sendSuccess(res, user);
  }),
);
