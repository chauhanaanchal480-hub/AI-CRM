import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { aiProvider } from '../../services/ai/index.js';
import type { InteractionInput } from '../../services/ai/AiProvider.js';
import { logActivity } from '../../services/activity.service.js';
import { aiRateLimiter } from '../../middleware/rateLimit.js';
import { cached, cacheTtl, invalidateCache } from '../../performance/cache.js';
import { runAiJob } from '../../performance/jobs.js';

const idParam = z.object({ id: z.string().cuid('Invalid id') });

/** Assemble the interaction history the AI provider reasons over. */
async function loadContext(customerId: string): Promise<{ name: string; input: InteractionInput }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      activities: { orderBy: { createdAt: 'desc' }, take: 40 },
      emails: { orderBy: { sentAt: 'desc' }, take: 30 },
      customerNotes: { orderBy: { createdAt: 'desc' }, take: 30 },
    },
  });
  if (!customer) throw ApiError.notFound('Customer not found');
  return {
    name: customer.name,
    input: {
      customerName: customer.name,
      company: customer.company,
      activities: customer.activities.map((a) => ({ type: a.type, summary: a.summary, createdAt: a.createdAt })),
      emails: customer.emails.map((e) => ({ subject: e.subject, body: e.body, direction: e.direction, sentAt: e.sentAt })),
      notes: customer.customerNotes.map((n) => ({ body: n.body, createdAt: n.createdAt })),
    },
  };
}

function assertAccess(req: Request, ownerId?: string) {
  if (req.user!.role === 'EMPLOYEE' && ownerId && ownerId !== req.user!.sub) {
    throw ApiError.forbidden('You do not have access to this customer');
  }
}

export const aiRouter = Router();
aiRouter.use(authenticate, aiRateLimiter);

// Summarize a customer's interaction history and persist the insight.
aiRouter.post(
  '/customers/:id/summarize',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
    if (!customer) throw ApiError.notFound('Customer not found');
    assertAccess(req, customer.ownerId);

    const { input } = await loadContext(req.params.id);
    const summary = await cached({
      namespace: `ai:${aiProvider.name}:summary`,
      scope: input,
      tags: [`ai:customer:${req.params.id}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'summary', input }, () => aiProvider.summarizeInteractions(input)),
    });

    const insight = await prisma.aiInsight.create({
      data: { kind: 'SUMMARY', content: summary, customerId: req.params.id },
    });
    await logActivity({ type: 'AI_INSIGHT', summary: 'AI generated an interaction summary', userId: req.user!.sub, customerId: req.params.id });
    return sendSuccess(res, { insight, provider: aiProvider.name }, 201);
  }),
);

// Suggest concrete follow-up actions.
aiRouter.post(
  '/customers/:id/suggest-followups',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
    if (!customer) throw ApiError.notFound('Customer not found');
    assertAccess(req, customer.ownerId);

    const { input } = await loadContext(req.params.id);
    const suggestions = await cached({
      namespace: `ai:${aiProvider.name}:followups`,
      scope: input,
      tags: [`ai:customer:${req.params.id}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'followups', input }, () => aiProvider.suggestFollowUps(input)),
    });

    // Persist a compact record of the suggestions for the timeline.
    await prisma.aiInsight.create({
      data: { kind: 'FOLLOWUP', content: suggestions.map((s) => `• ${s.title}`).join('\n'), customerId: req.params.id },
    });
    return sendSuccess(res, { suggestions, provider: aiProvider.name });
  }),
);

// Draft a personalised outreach email for a customer.
const draftEmailSchema = z.object({
  purpose: z.string().min(1).max(300),
  tone: z.enum(['FRIENDLY', 'FORMAL', 'CONCISE']).default('FRIENDLY'),
});
aiRouter.post(
  '/customers/:id/draft-email',
  validate({ params: idParam, body: draftEmailSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { ownerId: true, company: true } });
    if (!customer) throw ApiError.notFound('Customer not found');
    assertAccess(req, customer.ownerId);

    const { name, input } = await loadContext(req.params.id);
    const body = req.body as z.infer<typeof draftEmailSchema>;
    const emailInput = {
      customerName: name,
      company: customer.company,
      purpose: body.purpose,
      tone: body.tone,
      context: input,
    };
    const draft = await cached({
      namespace: `ai:${aiProvider.name}:email`,
      scope: emailInput,
      tags: [`ai:customer:${req.params.id}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'email-draft', input: emailInput }, () => aiProvider.generateEmail(emailInput)),
    });
    return sendSuccess(res, { draft, provider: aiProvider.name });
  }),
);

// Summarise meeting notes / a transcript into summary + key points + actions.
const meetingSchema = z.object({
  transcript: z.string().min(1).max(20_000),
  save: z.boolean().default(true),
});
aiRouter.post(
  '/customers/:id/meeting-summary',
  validate({ params: idParam, body: meetingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
    if (!customer) throw ApiError.notFound('Customer not found');
    assertAccess(req, customer.ownerId);

    const { name } = await loadContext(req.params.id);
    const { transcript, save } = req.body as z.infer<typeof meetingSchema>;
    const meetingInput = { customerName: name, transcript };
    const result = await cached({
      namespace: `ai:${aiProvider.name}:meeting`,
      scope: meetingInput,
      tags: [`ai:customer:${req.params.id}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'meeting-summary', input: meetingInput }, () => aiProvider.summarizeMeeting(meetingInput)),
    });

    if (save) {
      const content = [
        result.summary,
        result.keyPoints.length ? `\nKey points:\n${result.keyPoints.map((p) => `• ${p}`).join('\n')}` : '',
        result.actionItems.length ? `\nAction items:\n${result.actionItems.map((a) => `• ${a}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
      await prisma.aiInsight.create({ data: { kind: 'SUMMARY', content, customerId: req.params.id } });
      await logActivity({ type: 'MEETING', summary: 'AI summarised a meeting', userId: req.user!.sub, customerId: req.params.id });
    }
    return sendSuccess(res, { ...result, provider: aiProvider.name }, save ? 201 : 200);
  }),
);

// Score a lead's likelihood to convert and persist the result.
aiRouter.post(
  '/leads/:id/score',
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { activities: true } } },
    });
    if (!lead) throw ApiError.notFound('Lead not found');
    if (req.user!.role === 'EMPLOYEE' && lead.assignedToId && lead.assignedToId !== req.user!.sub) {
      throw ApiError.forbidden('You do not have access to this lead');
    }

    const ageDays = Math.floor((Date.now() - lead.createdAt.getTime()) / 86_400_000);
    const scoreInput = {
      title: lead.title,
      status: lead.status,
      source: lead.source,
      value: Number(lead.value),
      hasContactEmail: !!lead.contactEmail,
      hasContactPhone: !!lead.contactPhone,
      ageDays,
      activityCount: lead._count.activities,
    };
    const result = await cached({
      namespace: `ai:${aiProvider.name}:lead-score`,
      scope: scoreInput,
      tags: [`lead:${lead.id}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'lead-score', input: scoreInput }, () => aiProvider.scoreLead(scoreInput)),
    });

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { score: result.score, scoreRating: result.rating, scoreReason: result.reason, scoredAt: new Date() },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        customer: { select: { id: true, name: true, company: true } },
      },
    });
    await invalidateCache('leads', 'analytics', `lead:${lead.id}`);
    return sendSuccess(res, { lead: updated, provider: aiProvider.name });
  }),
);
