import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { aiProvider } from '../../services/ai/index.js';
import type {
  EmailDraftInput,
  InteractionInput,
  MeetingSummaryInput,
} from '../../services/ai/AiProvider.js';
import { logActivity } from '../../services/activity.service.js';
import { cached, cacheTtl, invalidateCache } from '../../performance/cache.js';
import { runAiJob } from '../../performance/jobs.js';
import { ApiError } from '../../utils/ApiError.js';

interface Actor { id: string; role: Role; }

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
      activities: customer.activities.map((activity) => ({
        type: activity.type,
        summary: activity.summary,
        createdAt: activity.createdAt,
      })),
      emails: customer.emails.map((email) => ({
        subject: email.subject,
        body: email.body,
        direction: email.direction,
        sentAt: email.sentAt,
      })),
      notes: customer.customerNotes.map((note) => ({ body: note.body, createdAt: note.createdAt })),
    },
  };
}

function assertCustomerAccess(actor: Actor, ownerId?: string) {
  if (actor.role === 'EMPLOYEE' && ownerId && ownerId !== actor.id) {
    throw ApiError.forbidden('You do not have access to this customer');
  }
}

async function loadCustomerOwner(actor: Actor, customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { ownerId: true } });
  if (!customer) throw ApiError.notFound('Customer not found');
  assertCustomerAccess(actor, customer.ownerId);
}

export const aiService = {
  async summarizeCustomer(actor: Actor, customerId: string) {
    await loadCustomerOwner(actor, customerId);
    const { input } = await loadContext(customerId);
    const summary = await cached({
      namespace: `ai:${aiProvider.name}:summary`,
      scope: input,
      tags: [`ai:customer:${customerId}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'summary', input }, () => aiProvider.summarizeInteractions(input)),
    });
    const insight = await prisma.aiInsight.create({
      data: { kind: 'SUMMARY', content: summary, customerId },
    });
    await logActivity({
      type: 'AI_INSIGHT',
      summary: 'AI generated an interaction summary',
      userId: actor.id,
      customerId,
    });
    return { insight, provider: aiProvider.name };
  },

  async suggestFollowUps(actor: Actor, customerId: string) {
    await loadCustomerOwner(actor, customerId);
    const { input } = await loadContext(customerId);
    const suggestions = await cached({
      namespace: `ai:${aiProvider.name}:followups`,
      scope: input,
      tags: [`ai:customer:${customerId}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'followups', input }, () => aiProvider.suggestFollowUps(input)),
    });
    await prisma.aiInsight.create({
      data: {
        kind: 'FOLLOWUP',
        content: suggestions.map((suggestion) => `• ${suggestion.title}`).join('\n'),
        customerId,
      },
    });
    return { suggestions, provider: aiProvider.name };
  },

  async draftEmail(
    actor: Actor,
    customerId: string,
    input: { purpose: string; tone: EmailDraftInput['tone'] },
  ) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { ownerId: true, company: true },
    });
    if (!customer) throw ApiError.notFound('Customer not found');
    assertCustomerAccess(actor, customer.ownerId);
    const context = await loadContext(customerId);
    const emailInput: EmailDraftInput = {
      customerName: context.name,
      company: customer.company,
      purpose: input.purpose,
      tone: input.tone,
      context: context.input,
    };
    const draft = await cached({
      namespace: `ai:${aiProvider.name}:email`,
      scope: emailInput,
      tags: [`ai:customer:${customerId}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob({ operation: 'email-draft', input: emailInput }, () => aiProvider.generateEmail(emailInput)),
    });
    return { draft, provider: aiProvider.name };
  },

  async summarizeMeeting(actor: Actor, customerId: string, input: { transcript: string; save: boolean }) {
    await loadCustomerOwner(actor, customerId);
    const { name } = await loadContext(customerId);
    const meetingInput: MeetingSummaryInput = { customerName: name, transcript: input.transcript };
    const result = await cached({
      namespace: `ai:${aiProvider.name}:meeting`,
      scope: meetingInput,
      tags: [`ai:customer:${customerId}`],
      ttlSeconds: cacheTtl.ai,
      load: () => runAiJob(
        { operation: 'meeting-summary', input: meetingInput },
        () => aiProvider.summarizeMeeting(meetingInput),
      ),
    });
    if (input.save) {
      const content = [
        result.summary,
        result.keyPoints.length ? `\nKey points:\n${result.keyPoints.map((point) => `• ${point}`).join('\n')}` : '',
        result.actionItems.length ? `\nAction items:\n${result.actionItems.map((item) => `• ${item}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
      await prisma.aiInsight.create({ data: { kind: 'SUMMARY', content, customerId } });
      await logActivity({
        type: 'MEETING',
        summary: 'AI summarised a meeting',
        userId: actor.id,
        customerId,
      });
    }
    return { ...result, provider: aiProvider.name };
  },

  async scoreLead(actor: Actor, leadId: string) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { _count: { select: { activities: true } } },
    });
    if (!lead) throw ApiError.notFound('Lead not found');
    if (actor.role === 'EMPLOYEE' && lead.assignedToId && lead.assignedToId !== actor.id) {
      throw ApiError.forbidden('You do not have access to this lead');
    }
    const scoreInput = {
      title: lead.title,
      status: lead.status,
      source: lead.source,
      value: Number(lead.value),
      hasContactEmail: Boolean(lead.contactEmail),
      hasContactPhone: Boolean(lead.contactPhone),
      ageDays: Math.floor((Date.now() - lead.createdAt.getTime()) / 86_400_000),
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
      data: {
        score: result.score,
        scoreRating: result.rating,
        scoreReason: result.reason,
        scoredAt: new Date(),
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        customer: { select: { id: true, name: true, company: true } },
      },
    });
    await invalidateCache('leads', 'analytics', `lead:${lead.id}`);
    return { lead: updated, provider: aiProvider.name };
  },
};
