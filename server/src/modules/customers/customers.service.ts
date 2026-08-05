import type { Prisma, Role } from '@prisma/client';
import { fieldSecurity, prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildPaginationMeta } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';
import { logActivity } from '../../services/activity.service.js';
import type { CustomerListQuery } from './customers.validation.js';

interface Actor {
  id: string;
  role: Role;
}

/**
 * Employees only see customers they own; managers and admins see everything.
 * Returns a Prisma `where` fragment enforcing that scope.
 */
function scopeFor(actor: Actor): Prisma.CustomerWhereInput {
  return actor.role === 'EMPLOYEE' ? { ownerId: actor.id } : {};
}

export const customersService = {
  async list(actor: Actor, query: CustomerListQuery) {
    const { page, limit, search, status, ownerId, tag, sortBy, sortOrder } = query;
    const where: Prisma.CustomerWhereInput = {
      ...scopeFor(actor),
      ...(status ? { status } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { company: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { emailSearchTokens: { hasEvery: fieldSecurity.searchTokenQuery(search) } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.CustomerOrderByWithRelationInput = {
      [sortBy && ['name', 'company', 'createdAt', 'updatedAt', 'status'].includes(sortBy)
        ? sortBy
        : 'createdAt']: sortOrder,
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy,
        ...toPrismaPagination(page, limit),
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          _count: { select: { deals: true, leads: true, tasks: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, limit, total) };
  },

  async getById(actor: Actor, id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
        deals: { include: { stage: true }, orderBy: { updatedAt: 'desc' } },
        leads: { orderBy: { createdAt: 'desc' } },
        customerNotes: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
        emails: { orderBy: { sentAt: 'desc' } },
        attachments: { orderBy: { createdAt: 'desc' } },
        insights: { orderBy: { createdAt: 'desc' }, take: 5 },
        activities: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!customer) throw ApiError.notFound('Customer not found');
    if (actor.role === 'EMPLOYEE' && customer.ownerId !== actor.id) {
      throw ApiError.forbidden('You do not have access to this customer');
    }
    return customer;
  },

  async create(actor: Actor, data: Record<string, unknown>) {
    const ownerId = (data.ownerId as string) || actor.id;
    const customer = await prisma.customer.create({
      data: {
        ...(data as object),
        email: (data.email as string) || null,
        website: (data.website as string) || null,
        ownerId,
      } as Prisma.CustomerUncheckedCreateInput,
    });
    await logActivity({
      type: 'STATUS_CHANGE',
      summary: `Customer "${customer.name}" created`,
      userId: actor.id,
      customerId: customer.id,
    });
    return customer;
  },

  async update(actor: Actor, id: string, data: Record<string, unknown>) {
    await this.getById(actor, id); // enforces access + existence
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(data as object),
        ...(data.email !== undefined ? { email: (data.email as string) || null } : {}),
        ...(data.website !== undefined ? { website: (data.website as string) || null } : {}),
      } as Prisma.CustomerUncheckedUpdateInput,
    });
    await logActivity({
      type: 'STATUS_CHANGE',
      summary: `Customer "${customer.name}" updated`,
      userId: actor.id,
      customerId: customer.id,
    });
    return customer;
  },

  async remove(actor: Actor, id: string) {
    await this.getById(actor, id);
    // Only managers/admins may delete; employees can edit but not destroy.
    if (actor.role === 'EMPLOYEE') throw ApiError.forbidden('Only managers can delete customers');
    await prisma.customer.delete({ where: { id } });
    return { id };
  },
};
