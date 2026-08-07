import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { logActivity, notify } from '../../services/activity.service.js';
import { invalidateCache } from '../../performance/cache.js';

interface Actor { id: string; role: Role; }

function scopeFor(actor: Actor): Prisma.DealWhereInput {
  return actor.role === 'EMPLOYEE' ? { ownerId: actor.id } : {};
}

const dealInclude = {
  customer: { select: { id: true, name: true, company: true, avatarUrl: true } },
  owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} satisfies Prisma.DealInclude;

async function bulkResequence(
  tx: Prisma.TransactionClient,
  rows: readonly { id: string; position: number; stageId: string }[],
) {
  if (rows.length === 0) return;
  const values = Prisma.join(rows.map((row) => Prisma.sql`(${row.id}, ${row.position}, ${row.stageId})`));
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Deal" AS deal
    SET "position" = changes.position,
        "stageId" = changes.stage_id,
        "updatedAt" = NOW()
    FROM (VALUES ${values}) AS changes(id, position, stage_id)
    WHERE deal.id = changes.id
      AND deal."deletedAt" IS NULL
  `);
}

export const dealsService = {
  /** Returns the default pipeline with its stages and each stage's ordered deals. */
  async board(actor: Actor) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) throw ApiError.notFound('No pipeline configured');

    const deals = await prisma.deal.findMany({
      where: { stage: { pipelineId: pipeline.id }, ...scopeFor(actor) },
      include: dealInclude,
      orderBy: { position: 'asc' },
    });

    const dealsByStage = new Map<string, typeof deals>();
    for (const deal of deals) {
      const stageDeals = dealsByStage.get(deal.stageId);
      if (stageDeals) stageDeals.push(deal);
      else dealsByStage.set(deal.stageId, [deal]);
    }
    const columns = pipeline.stages.map((stage) => {
      const stageDeals = dealsByStage.get(stage.id) ?? [];
      return {
        ...stage,
        deals: stageDeals,
        totalValue: stageDeals.reduce((sum, d) => sum + Number(d.value), 0),
      };
    });
    return { pipelineId: pipeline.id, columns };
  },

  async getById(actor: Actor, id: string) {
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: { ...dealInclude, stage: true, tasks: true, attachments: true },
    });
    if (!deal) throw ApiError.notFound('Deal not found');
    if (actor.role === 'EMPLOYEE' && deal.ownerId !== actor.id) {
      throw ApiError.forbidden('You do not have access to this deal');
    }
    return deal;
  },

  async create(actor: Actor, data: Record<string, unknown>) {
    // New card lands at the bottom of its stage.
    const last = await prisma.deal.findFirst({
      where: { stageId: data.stageId as string },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const deal = await prisma.deal.create({
      data: {
        ...(data as object),
        ownerId: (data.ownerId as string) || actor.id,
        position: (last?.position ?? -1) + 1,
      } as Prisma.DealUncheckedCreateInput,
      include: dealInclude,
    });
    await logActivity({ type: 'DEAL_UPDATE', summary: `Deal "${deal.title}" created`, userId: actor.id, customerId: deal.customerId, dealId: deal.id });
    return deal;
  },

  async update(actor: Actor, id: string, data: Record<string, unknown>) {
    const existing = await this.getById(actor, id);
    const patch: Prisma.DealUncheckedUpdateInput = { ...(data as object) };
    // Close bookkeeping when status flips to WON/LOST.
    if (data.status && data.status !== existing.status) {
      patch.closedAt = data.status === 'OPEN' ? null : new Date();
      if (data.status === 'WON') patch.probability = 100;
    }
    const deal = await prisma.deal.update({ where: { id }, data: patch, include: dealInclude });
    await logActivity({ type: 'DEAL_UPDATE', summary: `Deal "${deal.title}" updated`, userId: actor.id, customerId: deal.customerId, dealId: deal.id });
    return deal;
  },

  /**
   * Move a deal to a target stage/position and re-sequence both the source and
   * destination columns so positions stay contiguous. Runs in a transaction.
   */
  async move(actor: Actor, id: string, targetStageId: string, targetPosition: number) {
    const deal = await this.getById(actor, id);
    const stage = await prisma.stage.findUnique({ where: { id: targetStageId } });
    if (!stage) throw ApiError.badRequest('Target stage does not exist');

    await prisma.$transaction(async (tx) => {
      // Pull the moving card out of its source column.
      const sourceSiblings = await tx.deal.findMany({
        where: { stageId: deal.stageId, id: { not: id } },
        orderBy: { position: 'asc' },
      });
      // Destination column without the moving card.
      const destSiblings =
        deal.stageId === targetStageId
          ? sourceSiblings
          : await tx.deal.findMany({
              where: { stageId: targetStageId, id: { not: id } },
              orderBy: { position: 'asc' },
            });

      const clamped = Math.min(Math.max(targetPosition, 0), destSiblings.length);
      destSiblings.splice(clamped, 0, deal as (typeof destSiblings)[number]);

      // One parameterized update replaces an update-per-card N+1 pattern.
      const destinationRows = destSiblings.map((item, index) => ({
        id: item.id,
        position: index,
        stageId: item.id === id ? targetStageId : item.stageId,
      }));
      const sourceRows = deal.stageId === targetStageId
        ? []
        : sourceSiblings.map((item, index) => ({ id: item.id, position: index, stageId: item.stageId }));
      await bulkResequence(tx, [...destinationRows, ...sourceRows]);
    });

    if (deal.stageId !== targetStageId) {
      await logActivity({
        type: 'DEAL_UPDATE',
        summary: `Deal "${deal.title}" moved to ${stage.name}`,
        userId: actor.id,
        customerId: deal.customerId,
        dealId: id,
        metadata: { from: deal.stageId, to: targetStageId },
      });
      if (stage.name.toLowerCase().includes('won')) {
        await notify({ userId: deal.ownerId, type: 'deal_won', title: `🎉 Deal moved to ${stage.name}`, body: deal.title, entityType: 'deal', entityId: id });
      }
    }
    return this.getById(actor, id);
  },

  async remove(actor: Actor, id: string) {
    const deal = await this.getById(actor, id);
    await prisma.deal.delete({ where: { id } });
    // Compact the column the card left behind.
    const siblings = await prisma.deal.findMany({ where: { stageId: deal.stageId }, orderBy: { position: 'asc' } });
    await prisma.$transaction((tx) => bulkResequence(
      tx,
      siblings.map((item, index) => ({ id: item.id, position: index, stageId: item.stageId })),
    ));
    await invalidateCache('analytics', `customer:${deal.customerId}`, `ai:customer:${deal.customerId}`);
    return { id };
  },
};
