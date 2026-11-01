import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { emailsService, type RecordEmailInput } from './emails.service.js';

const createSchema = z.object({
  customerId: z.string().min(1),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('OUTBOUND'),
  toAddr: z.string().email(),
  fromAddr: z.string().email(),
});

export const emailsRouter = Router();
emailsRouter.use(authenticate);

// Log an email against a customer (this app records email; it does not send SMTP).
emailsRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.body as z.infer<typeof createSchema>;
    const email = await emailsService.record(req.user!.sub, data as RecordEmailInput);
    return sendSuccess(res, email, 201);
  }),
);
