import { z } from 'zod';

/**
 * Shared pagination + sorting query schema. Individual list endpoints extend
 * this with their own `search`/filter fields.
 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(60).regex(/^[a-zA-Z_]*$/, 'Invalid sort field').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

/** Translate page/limit into Prisma skip/take. */
export function toPrismaPagination(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}
