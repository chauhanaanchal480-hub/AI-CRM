import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const taskListQuery = paginationQuery.extend({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
});

export const createTaskSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  status: statusEnum.default('TODO'),
  priority: priorityEnum.default('MEDIUM'),
  dueDate: z.coerce.date().optional(),
  assigneeId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  dealId: z.string().max(64).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();
export const idParam = z.object({ id: z.string().cuid('Invalid id') });
export type TaskListQuery = z.infer<typeof taskListQuery>;
