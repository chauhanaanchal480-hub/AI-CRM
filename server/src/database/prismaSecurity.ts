import type { Prisma } from '@prisma/client';
import { logger } from '../lib/logger.js';
import { getDatabaseSecurityContext } from './securityContext.js';
import type { FieldSecurity } from './fieldSecurity.js';

const softDeleteModels = new Set([
  'Customer', 'Lead', 'Deal', 'Task', 'Activity', 'Note', 'EmailLog', 'Attachment', 'Notification', 'AiInsight',
]);

const listRelations: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Customer: {
    leads: 'Lead', deals: 'Deal', activities: 'Activity', customerNotes: 'Note', emails: 'EmailLog',
    attachments: 'Attachment', tasks: 'Task', insights: 'AiInsight',
  },
  Deal: { activities: 'Activity', tasks: 'Task', attachments: 'Attachment' },
  Lead: { activities: 'Activity' },
  User: { ownedCustomers: 'Customer', assignedLeads: 'Lead', ownedDeals: 'Deal', tasks: 'Task', activities: 'Activity', notes: 'Note', emails: 'EmailLog', uploads: 'Attachment', notifications: 'Notification' },
};

const hiddenFields = new Set(['deletedAt', 'deletedById', 'emailSearchTokens', 'contactEmailSearchTokens']);

function withNotDeleted(where: unknown): Record<string, unknown> {
  return { ...((where && typeof where === 'object' ? where : {}) as Record<string, unknown>), deletedAt: null };
}

function secureNestedReads(model: string, query: unknown): void {
  if (!query || typeof query !== 'object') return;
  const args = query as Record<string, unknown>;
  for (const selectionName of ['include', 'select']) {
    const selection = args[selectionName];
    if (!selection || typeof selection !== 'object') continue;
    for (const [relation, targetModel] of Object.entries(listRelations[model] ?? {})) {
      const relationQuery = (selection as Record<string, unknown>)[relation];
      if (!relationQuery) continue;
      if (relationQuery === true) {
        (selection as Record<string, unknown>)[relation] = { where: { deletedAt: null } };
      } else if (typeof relationQuery === 'object') {
        const nested = relationQuery as Record<string, unknown>;
        nested.where = withNotDeleted(nested.where);
        secureNestedReads(targetModel, nested);
      }
    }
    const count = (selection as Record<string, unknown>)._count;
    if (count && typeof count === 'object') {
      const countSelect = (count as Record<string, unknown>).select;
      if (countSelect && typeof countSelect === 'object') {
        for (const [relation, targetModel] of Object.entries(listRelations[model] ?? {})) {
          if (!softDeleteModels.has(targetModel)) continue;
          const countValue = (countSelect as Record<string, unknown>)[relation];
          if (countValue === true) (countSelect as Record<string, unknown>)[relation] = { where: { deletedAt: null } };
          else if (countValue && typeof countValue === 'object') {
            const countArgs = countValue as Record<string, unknown>;
            countArgs.where = withNotDeleted(countArgs.where);
          }
        }
      }
    }
  }
}

function sanitizeResult(value: unknown, allowDeleted = false): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !item || typeof item !== 'object' || !('id' in item) || !('deletedAt' in item) || item.deletedAt === null)
      .map((item) => sanitizeResult(item));
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  const securedRecord = Object.hasOwn(record, 'id') && [...hiddenFields].some((field) => Object.hasOwn(record, field));
  if (!allowDeleted && securedRecord && record.deletedAt) return null;
  for (const [key, item] of Object.entries(record)) {
    if (securedRecord && hiddenFields.has(key)) delete record[key];
    else record[key] = sanitizeResult(item);
  }
  return record;
}

export function createPrismaSecurityMiddleware(options: {
  fields: FieldSecurity;
  onError: (model: string | undefined, action: string, error: unknown) => void;
}): Prisma.Middleware {
  return async (params, next) => {
    const originalAction = params.action;
    const isSoftModel = Boolean(params.model && softDeleteModels.has(params.model));
    const allowDeleted = getDatabaseSecurityContext()?.allowDeleted === true;
    params.args ??= {};

    if (isSoftModel) {
      if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = {
          deletedAt: new Date(),
          deletedById: getDatabaseSecurityContext()?.actorId ?? null,
        };
      } else if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args.data = {
          deletedAt: new Date(),
          deletedById: getDatabaseSecurityContext()?.actorId ?? null,
        };
      }

      if (!allowDeleted && ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany'].includes(params.action)) {
        params.args.where = withNotDeleted(params.args.where);
      }
      if (!allowDeleted) secureNestedReads(params.model as string, params.args);
    }

    options.fields.encryptMutation(params.model, params.action, params.args);
    try {
      const result = await next(params);
      if (isSoftModel && ['delete', 'deleteMany'].includes(originalAction)) {
        const context = getDatabaseSecurityContext();
        logger.info(
          {
            event: 'database.soft_delete',
            model: params.model,
            actorId: context?.actorId,
            requestId: context?.requestId,
          },
          'Database record soft deleted',
        );
      }
      return options.fields.decryptResult(sanitizeResult(result, allowDeleted || ['delete', 'deleteMany'].includes(originalAction)));
    } catch (error) {
      options.onError(params.model, originalAction, error);
      throw error;
    }
  };
}
