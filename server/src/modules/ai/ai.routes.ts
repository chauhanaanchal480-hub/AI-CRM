import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { aiRateLimiter } from '../../middleware/rateLimit.js';
import { aiService } from './ai.service.js';

const idParam = z.object({ id: z.string().cuid('Invalid id') });
const draftEmailSchema = z.object({
  purpose: z.string().min(1).max(300),
  tone: z.enum(['FRIENDLY', 'FORMAL', 'CONCISE']).default('FRIENDLY'),
});
const meetingSchema = z.object({
  transcript: z.string().min(1).max(20_000),
  save: z.boolean().default(true),
});

function actor(req: Request) {
  return { id: req.user!.sub, role: req.user!.role };
}

export const aiRouter = Router();
aiRouter.use(authenticate, aiRateLimiter);

aiRouter.post(
  '/customers/:id/summarize',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(res, await aiService.summarizeCustomer(actor(req), req.params.id), 201)),
);

aiRouter.post(
  '/customers/:id/suggest-followups',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(res, await aiService.suggestFollowUps(actor(req), req.params.id))),
);

aiRouter.post(
  '/customers/:id/draft-email',
  validate({ params: idParam, body: draftEmailSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await aiService.draftEmail(actor(req), req.params.id, req.body as z.infer<typeof draftEmailSchema>),
    )),
);

aiRouter.post(
  '/customers/:id/meeting-summary',
  validate({ params: idParam, body: meetingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof meetingSchema>;
    return sendSuccess(
      res,
      await aiService.summarizeMeeting(actor(req), req.params.id, input),
      input.save ? 201 : 200,
    );
  }),
);

aiRouter.post(
  '/leads/:id/score',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(res, await aiService.scoreLead(actor(req), req.params.id))),
);
