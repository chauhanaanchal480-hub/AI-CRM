import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

export const customerListQuery = paginationQuery.extend({
  status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'CHURNED']).optional(),
  ownerId: z.string().max(64).optional(),
  tag: z.string().max(60).optional(),
});

// Only web URLs — blocks javascript:/data: schemes that would become XSS
// when the client renders the value inside an href.
const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), 'Only http(s) URLs are allowed');

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  company: z.string().max(120).optional(),
  email: z.string().email().max(254).optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'CHURNED']).default('LEAD'),
  tags: z.array(z.string().max(60)).max(10).default([]),
  website: httpUrl.optional().or(z.literal('')),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  ownerId: z.string().max(64).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const idParam = z.object({ id: z.string().cuid('Invalid id') });

export type CustomerListQuery = z.infer<typeof customerListQuery>;
