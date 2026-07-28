import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { logActivity } from '../../services/activity.service.js';

const createSchema = z.object({
  customerId: z.string().min(1),
  body: z.string().min(1).max(4000),
});
const idParam = z.object({ id: z.string().cuid('Invalid id') });

export const notesRouter = Router();
notesRouter.use(authenticate);

notesRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { customerId, body } = req.body as z.infer<typeof createSchema>;
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.notFound('Customer not found');
    const note = await prisma.note.create({
      data: { customerId, body, userId: req.user!.sub },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await logActivity({ type: 'NOTE', summary: body.slice(0, 120), userId: req.user!.sub, customerId });
    return sendSuccess(res, note, 201);
  }),
);

notesRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) throw ApiError.notFound('Note not found');
    // Author, managers and admins may delete.
    if (req.user!.role === 'EMPLOYEE' && note.userId !== req.user!.sub) {
      throw ApiError.forbidden('You can only delete your own notes');
    }
    await prisma.note.delete({ where: { id: req.params.id } });
    return sendSuccess(res, { id: req.params.id });
  }),
);
