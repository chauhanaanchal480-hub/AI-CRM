import type { Prisma, Role } from '@prisma/client';
import { fieldSecurity, prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildPaginationMeta } from '../../utils/apiResponse.js';
import { toPrismaPagination } from '../../utils/pagination.js';
import { logActivity } from '../../services/activity.service.js';
import type { LeadListQuery } from './leads.validation.js';
import { cached, cacheTtl, invalidateCache } from '../../performance/cache.js';

interface Actor { id: string; role: Role; }

function scopeFor(actor: Actor): Prisma.LeadWhereInput {
  return actor.role === 'EMPLOYEE' ? { assignedToId: actor.id } : {};
}

const includeRefs = {
  assignedTo: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  customer: { select: { id: true, name: true, company: true } },
};

export const leadsService = {
  async list(actor: Actor, q: LeadListQuery) {
    return cached({
      namespace: 'leads:list',
      scope: { actor, query: q },
      tags: ['leads'],
      ttlSeconds: cacheTtl.entity,
      load: async () => {
    const where: Prisma.LeadWhereInput = {
      ...scopeFor(actor),
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { contactName: { contains: q.search, mode: 'insensitive' } },
              { contactEmail: { contains: q.search, mode: 'insensitive' } },
              { contactEmailSearchTokens: { hasEvery: fieldSecurity.searchTokenQuery(q.search) } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: includeRefs,
        orderBy: { [q.sortBy && ['createdAt', 'value', 'status'].includes(q.sortBy) ? q.sortBy : 'createdAt']: q.sortOrder },
        ...toPrismaPagination(q.page, q.limit),
      }),
      prisma.lead.count({ where }),
    ]);
        return { items, meta: buildPaginationMeta(q.page, q.limit, total) };
      },
    });
  },

  async getById(actor: Actor, id: string) {
    return cached({
      namespace: 'leads:detail',
      scope: { actor, id },
      tags: ['leads', `lead:${id}`],
      ttlSeconds: cacheTtl.entity,
      load: async () => {
    const lead = await prisma.lead.findUnique({ where: { id }, include: includeRefs });
    if (!lead) throw ApiError.notFound('Lead not found');
    if (actor.role === 'EMPLOYEE' && lead.assignedToId !== actor.id) {
      throw ApiError.forbidden('You do not have access to this lead');
    }
        return lead;
      },
    });
  },

  async create(actor: Actor, data: Record<string, unknown>) {
    const lead = await prisma.lead.create({
      data: {
        ...(data as object),
        contactEmail: (data.contactEmail as string) || null,
        assignedToId: (data.assignedToId as string) || actor.id,
      } as Prisma.LeadUncheckedCreateInput,
      include: includeRefs,
    });
    await logActivity({ type: 'STATUS_CHANGE', summary: `Lead "${lead.title}" created`, userId: actor.id, customerId: lead.customerId, leadId: lead.id });
    await invalidateCache('leads', 'analytics', `lead:${lead.id}`, ...(lead.customerId ? [`customer:${lead.customerId}`, `ai:customer:${lead.customerId}`] : []));
    return lead;
  },

  async update(actor: Actor, id: string, data: Record<string, unknown>) {
    await this.getById(actor, id);
    const lead = await prisma.lead.update({
      where: { id },
      data: { ...(data as object), ...(data.contactEmail !== undefined ? { contactEmail: (data.contactEmail as string) || null } : {}) } as Prisma.LeadUncheckedUpdateInput,
      include: includeRefs,
    });
    await logActivity({ type: 'STATUS_CHANGE', summary: `Lead "${lead.title}" updated to ${lead.status}`, userId: actor.id, customerId: lead.customerId, leadId: lead.id });
    await invalidateCache('leads', 'analytics', `lead:${id}`, ...(lead.customerId ? [`customer:${lead.customerId}`, `ai:customer:${lead.customerId}`] : []));
    return lead;
  },

  /** Convert a lead into a customer (if not already linked) and mark CONVERTED. */
  async convert(actor: Actor, id: string) {
    const lead = await this.getById(actor, id);
    let customerId = lead.customerId;
    if (!customerId) {
      const customer = await prisma.customer.create({
        data: {
          name: lead.contactName ?? lead.title,
          email: lead.contactEmail,
          phone: lead.contactPhone,
          status: 'ACTIVE',
          ownerId: lead.assignedToId ?? actor.id,
        },
      });
      customerId = customer.id;
    }
    const updated = await prisma.lead.update({
      where: { id },
      data: { status: 'CONVERTED', customerId },
      include: includeRefs,
    });
    await logActivity({ type: 'STATUS_CHANGE', summary: `Lead "${lead.title}" converted to customer`, userId: actor.id, customerId, leadId: id });
    await invalidateCache('leads', 'customers', 'analytics', `lead:${id}`, `customer:${customerId}`, `ai:customer:${customerId}`);
    return updated;
  },

  async remove(actor: Actor, id: string) {
    const lead = await this.getById(actor, id);
    await prisma.lead.delete({ where: { id } });
    await invalidateCache('leads', 'analytics', `lead:${id}`, ...(lead.customerId ? [`customer:${lead.customerId}`, `ai:customer:${lead.customerId}`] : []));
    return { id };
  },
};
