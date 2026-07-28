import { z } from 'zod';

export const createDealSchema = z.object({
  title: z.string().min(1).max(160),
  value: z.coerce.number().min(0).default(0),
  currency: z.string().length(3).default('USD'),
  probability: z.coerce.number().int().min(0).max(100).default(50),
  expectedCloseDate: z.coerce.date().optional(),
  stageId: z.string().min(1),
  customerId: z.string().min(1),
  ownerId: z.string().optional(),
});

export const updateDealSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  value: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  stageId: z.string().optional(),
});

/** Payload for drag-and-drop: which stage the card lands in and at what index. */
export const moveDealSchema = z.object({
  stageId: z.string().min(1),
  position: z.coerce.number().int().min(0),
});

export const idParam = z.object({ id: z.string().cuid('Invalid id') });
