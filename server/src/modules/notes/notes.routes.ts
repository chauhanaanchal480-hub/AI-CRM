import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { notesService } from './notes.service.js';

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
    return sendSuccess(
      res,
      await notesService.create({ id: req.user!.sub, role: req.user!.role }, { customerId, body }),
      201,
    );
  }),
);

notesRouter.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    return sendSuccess(
      res,
      await notesService.remove({ id: req.user!.sub, role: req.user!.role }, req.params.id),
    );
  }),
);
