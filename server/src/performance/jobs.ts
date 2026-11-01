import type {
  EmailDraftInput,
  InteractionInput,
  LeadScoreInput,
  MeetingSummaryInput,
} from '../services/ai/AiProvider.js';
import { runQueuedJob } from './queue.js';

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
