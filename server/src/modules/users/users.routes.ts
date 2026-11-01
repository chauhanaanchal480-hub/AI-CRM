import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { passwordSchema } from '../auth/auth.validation.js';
import { requireStepUp } from '../../middleware/requireStepUp.js';
import {
  usersService,
  type UpdateProfileInput,
  type UpdateUserAccessInput,
} from './users.service.js';

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
    return sendSuccess(res, await usersService.listActive());
  }),
);

// Update own profile.
usersRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.body as z.infer<typeof updateProfileSchema>;
    return sendSuccess(res, await usersService.updateProfile(req.user!.sub, data as UpdateProfileInput));
  }),
);

// Change own password.
usersRouter.post(
  '/me/password',
  requireStepUp,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    return sendSuccess(res, await usersService.changePassword(req.user!.sub, currentPassword, newPassword));
  }),
);

// Admin: change a user's role / activation.
usersRouter.patch(
  '/:id',
  authorize('ADMIN'),
  requireStepUp,
  validate({ params: idParam, body: updateRoleSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(
      res,
      await usersService.updateAccess(
        req.user!.sub,
        req.params.id,
        req.body as UpdateUserAccessInput,
      ),
    );
  }),
);
