import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const statusEnum = z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED']);
const sourceEnum = z.enum(['WEBSITE', 'REFERRAL', 'COLD_CALL', 'EVENT', 'SOCIAL', 'EMAIL_CAMPAIGN', 'OTHER']);

export const leadListQuery = paginationQuery.extend({
  status: statusEnum.optional(),
  source: sourceEnum.optional(),
  assignedToId: z.string().max(64).optional(),
});

export const createLeadSchema = z.object({
  title: z.string().min(1).max(160),
  status: statusEnum.default('NEW'),
  source: sourceEnum.default('WEBSITE'),
  value: z.coerce.number().min(0).default(0),
  contactName: z.string().max(120).optional(),
  contactEmail: z.string().email().max(254).optional().or(z.literal('')),
  contactPhone: z.string().max(40).optional(),
  customerId: z.string().max(64).optional(),
  assignedToId: z.string().max(64).optional(),
});

export const updateLeadSchema = createLeadSchema.partial();
export const idParam = z.object({ id: z.string().cuid('Invalid id') });
export type LeadListQuery = z.infer<typeof leadListQuery>;
