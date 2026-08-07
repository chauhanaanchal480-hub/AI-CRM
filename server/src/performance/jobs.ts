import type {
  EmailDraftInput,
  InteractionInput,
  LeadScoreInput,
  MeetingSummaryInput,
} from '../services/ai/AiProvider.js';
import { prisma } from '../lib/prisma.js';
import { logActivity } from '../services/activity.service.js';
import { runQueuedJob } from './queue.js';

export interface RecordEmailJob {
  customerId: string;
  subject: string;
  body: string;
  direction: 'INBOUND' | 'OUTBOUND';
  toAddr: string;
  fromAddr: string;
  userId: string;
}

export async function recordEmailJob(payload: RecordEmailJob) {
  // Recording an email is a small consistency-sensitive write, not background
  // work. Keeping it inline avoids duplicate records under at-least-once queue
  // delivery while preserving the existing synchronous API contract.
  const email = await prisma.emailLog.create({ data: payload });
  await logActivity({
    type: 'EMAIL',
    summary: `${payload.direction === 'OUTBOUND' ? 'Sent' : 'Received'}: ${payload.subject}`,
    userId: payload.userId,
    customerId: payload.customerId,
  });
  return email;
}

export type AiJob =
  | { operation: 'summary'; input: InteractionInput }
  | { operation: 'followups'; input: InteractionInput }
  | { operation: 'lead-score'; input: LeadScoreInput }
  | { operation: 'email-draft'; input: EmailDraftInput }
  | { operation: 'meeting-summary'; input: MeetingSummaryInput };

export function runAiJob<TResult>(payload: AiJob, fallback: () => Promise<TResult>) {
  return runQueuedJob<AiJob, TResult>({
    queue: 'ai',
    name: payload.operation,
    payload,
    fallback,
    priority: payload.operation === 'lead-score' ? 4 : 5,
  });
}
