import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildPaginationMeta } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';
import type { TaskListQuery } from './tasks.validation.js';
import { invalidateCache } from '../../performance/cache.js';

interface Actor { id: string; role: Role; }

const include = {
  customer: { select: { id: true, name: true, company: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
};

export const tasksService = {
  async list(actor: Actor, q: TaskListQuery) {
    // Employees are always scoped to their own tasks; managers/admins may widen.
    const restrictToSelf = actor.role === 'EMPLOYEE' || q.scope === 'mine';
    const where: Prisma.TaskWhereInput = {
      ...(restrictToSelf ? { assigneeId: actor.id } : {}),
      ...(q.assigneeId && !restrictToSelf ? { assigneeId: q.assigneeId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        ...toPrismaPagination(q.page, q.limit),
      }),
      prisma.task.count({ where }),
    ]);
    return { items, meta: buildPaginationMeta(q.page, q.limit, total) };
  },

  async getById(actor: Actor, id: string) {
    const task = await prisma.task.findUnique({ where: { id }, include });
    if (!task) throw ApiError.notFound('Task not found');
    if (actor.role === 'EMPLOYEE' && task.assigneeId !== actor.id) {
      throw ApiError.forbidden('You do not have access to this task');
    }
    return task;
  },

  async create(actor: Actor, data: Record<string, unknown>) {
    const task = await prisma.task.create({
      data: { ...(data as object), assigneeId: (data.assigneeId as string) || actor.id } as Prisma.TaskUncheckedCreateInput,
      include,
    });
    await invalidateCache('analytics', ...(task.customerId ? [`customer:${task.customerId}`] : []));
    return task;
  },

  async update(actor: Actor, id: string, data: Record<string, unknown>) {
    await this.getById(actor, id);
    const patch: Prisma.TaskUncheckedUpdateInput = { ...(data as object) };
    if (data.status) patch.completedAt = data.status === 'DONE' ? new Date() : null;
    const task = await prisma.task.update({ where: { id }, data: patch, include });
    await invalidateCache('analytics', ...(task.customerId ? [`customer:${task.customerId}`] : []));
    return task;
  },

  async remove(actor: Actor, id: string) {
    const task = await this.getById(actor, id);
    await prisma.task.delete({ where: { id } });
    await invalidateCache('analytics', ...(task.customerId ? [`customer:${task.customerId}`] : []));
    return { id };
  },
};
