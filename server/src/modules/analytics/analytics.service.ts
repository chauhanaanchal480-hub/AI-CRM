import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { cached, cacheTtl } from '../../performance/cache.js';

interface Actor { id: string; role: Role; }

function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  return actor.role === 'EMPLOYEE' ? { ownerId: actor.id } : {};
}
function dealScope(actor: Actor): Prisma.DealWhereInput {
  return actor.role === 'EMPLOYEE' ? { ownerId: actor.id } : {};
}

export const analyticsService = {
  async dashboard(actor: Actor) {
    return cached({
      namespace: 'analytics:dashboard',
      scope: actor,
      tags: ['analytics'],
      ttlSeconds: cacheTtl.dashboard,
      load: async () => {
    const [customers, activeCustomers, openDeals, wonDeals, tasksDue, leads] = await Promise.all([
      prisma.customer.count({ where: customerScope(actor) }),
      prisma.customer.count({ where: { ...customerScope(actor), status: 'ACTIVE' } }),
      prisma.deal.aggregate({ where: { ...dealScope(actor), status: 'OPEN' }, _sum: { value: true }, _count: { _all: true } }),
      prisma.deal.aggregate({ where: { ...dealScope(actor), status: 'WON' }, _sum: { value: true }, _count: { _all: true } }),
      prisma.task.count({
        where: {
          assigneeId: actor.role === 'EMPLOYEE' ? actor.id : undefined,
          status: { not: 'DONE' },
          dueDate: { lte: new Date(Date.now() + 7 * 86_400_000) },
        },
      }),
      prisma.lead.count({ where: actor.role === 'EMPLOYEE' ? { assignedToId: actor.id } : {} }),
    ]);

    const openValue = Number(openDeals._sum.value ?? 0);
    const wonValue = Number(wonDeals._sum.value ?? 0);
    const winRate =
      wonDeals._count._all + openDeals._count._all > 0
        ? Math.round((wonDeals._count._all / (wonDeals._count._all + openDeals._count._all)) * 100)
        : 0;

    return {
      totalCustomers: customers,
      activeCustomers,
      openDealsCount: openDeals._count._all,
      openPipelineValue: openValue,
      wonDealsCount: wonDeals._count._all,
      wonValue,
      winRate,
      tasksDueSoon: tasksDue,
      totalLeads: leads,
    };
      },
    });
  },

  /** Deal count + value grouped by pipeline stage (for the funnel/bar chart). */
  async dealsByStage(actor: Actor) {
    return cached({
      namespace: 'analytics:deals-by-stage',
      scope: actor,
      tags: ['analytics'],
      ttlSeconds: cacheTtl.analytics,
      load: async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) return [];
    const grouped = await prisma.deal.groupBy({
      by: ['stageId'],
      where: { stage: { pipelineId: pipeline.id }, ...dealScope(actor) },
      _count: { _all: true },
      _sum: { value: true },
    });
    const byStage = new Map(grouped.map((group) => [group.stageId, group]));
    return pipeline.stages.map((s) => {
      const inStage = byStage.get(s.id);
      return {
        stage: s.name,
        color: s.color,
        count: inStage?._count._all ?? 0,
        value: Number(inStage?._sum.value ?? 0),
      };
    });
      },
    });
  },

  /** Won deal value per month for the last 6 months (revenue trend line). */
  async revenueTrend(actor: Actor) {
    return cached({
      namespace: 'analytics:revenue-trend',
      scope: actor,
      tags: ['analytics'],
      ttlSeconds: cacheTtl.analytics,
      load: async () => {
    const start = new Date();
    start.setMonth(start.getMonth() - 5);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const ownerScope = actor.role === 'EMPLOYEE'
      ? Prisma.sql`AND "ownerId" = ${actor.id}`
      : Prisma.empty;
    const totals = await prisma.$queryRaw<{ month: Date; value: unknown }[]>(Prisma.sql`
      SELECT date_trunc('month', "closedAt") AS month,
             COALESCE(SUM("value"), 0) AS value
      FROM "Deal"
      WHERE "status" = 'WON'
        AND "closedAt" >= ${start}
        AND "deletedAt" IS NULL
        ${ownerScope}
      GROUP BY date_trunc('month', "closedAt")
      ORDER BY month ASC
    `);

    const months: { label: string; value: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      months.push({ label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }), value: 0 });
    }
    for (const total of totals) {
      const idx =
        (total.month.getFullYear() - start.getFullYear()) * 12 +
        (total.month.getMonth() - start.getMonth());
      if (idx >= 0 && idx < months.length) months[idx].value = Number(total.value);
    }
        return months;
      },
    });
  },

  /** Lead counts grouped by source (for the donut chart). */
  async leadsBySource(actor: Actor) {
    return cached({
      namespace: 'analytics:leads-by-source',
      scope: actor,
      tags: ['analytics'],
      ttlSeconds: cacheTtl.analytics,
      load: async () => {
    const grouped = await prisma.lead.groupBy({
      by: ['source'],
      _count: { _all: true },
      where: actor.role === 'EMPLOYEE' ? { assignedToId: actor.id } : {},
    });
        return grouped.map((g) => ({ source: g.source, count: g._count._all }));
      },
    });
  },
};
