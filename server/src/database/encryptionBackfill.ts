import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Prisma } from '@prisma/client';
import { runWithDatabaseSecurityContext } from './securityContext.js';

const BATCH_SIZE = 200;

type BackfillTarget =
  | 'User'
  | 'Customer'
  | 'Lead'
  | 'Task'
  | 'Activity'
  | 'Note'
  | 'EmailLog'
  | 'Attachment'
  | 'Notification'
  | 'AiInsight'
  | 'AuditLog';

function backfillCandidates(currentKeyId: string): ReadonlyArray<{ model: BackfillTarget; condition: string }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(currentKeyId)) throw new Error('Current encryption key ID is invalid');
  const currentEnvelope = `enc:v1:${currentKeyId}:%`;
  const textNeedsEncryption = (field: string) => `("${field}" IS NOT NULL AND "${field}" NOT LIKE '${currentEnvelope}')`;
  const jsonNeedsEncryption = (field: string) => `("${field}" IS NOT NULL AND "${field}" <> 'null'::jsonb AND (jsonb_typeof("${field}") <> 'string' OR "${field}" #>> '{}' NOT LIKE '${currentEnvelope}'))`;

  return [
    { model: 'User', condition: textNeedsEncryption('phone') },
    { model: 'Customer', condition: `(${textNeedsEncryption('email')} OR ("email" IS NOT NULL AND cardinality("emailSearchTokens") = 0) OR ${textNeedsEncryption('phone')} OR ${textNeedsEncryption('address')} OR ${textNeedsEncryption('notes')})` },
    { model: 'Lead', condition: `(${textNeedsEncryption('contactEmail')} OR ("contactEmail" IS NOT NULL AND cardinality("contactEmailSearchTokens") = 0) OR ${textNeedsEncryption('contactPhone')} OR ${textNeedsEncryption('scoreReason')})` },
    { model: 'Task', condition: textNeedsEncryption('description') },
    { model: 'Activity', condition: `(${textNeedsEncryption('summary')} OR ${jsonNeedsEncryption('metadata')})` },
    { model: 'Note', condition: textNeedsEncryption('body') },
    { model: 'EmailLog', condition: `(${textNeedsEncryption('subject')} OR ${textNeedsEncryption('body')} OR ${textNeedsEncryption('fromAddr')} OR ${textNeedsEncryption('toAddr')})` },
    { model: 'Attachment', condition: textNeedsEncryption('originalName') },
    { model: 'Notification', condition: `(${textNeedsEncryption('title')} OR ${textNeedsEncryption('body')})` },
    { model: 'AiInsight', condition: textNeedsEncryption('content') },
    { model: 'AuditLog', condition: jsonNeedsEncryption('metadata') },
  ];
}

async function backfillRecord(model: BackfillTarget, id: string) {
  switch (model) {
    case 'User': {
      const row = await prisma.user.findUnique({ where: { id }, select: { phone: true } });
      if (row) await prisma.user.update({ where: { id }, data: { phone: row.phone } });
      break;
    }
    case 'Customer': {
      const row = await prisma.customer.findUnique({ where: { id }, select: { email: true, phone: true, address: true, notes: true } });
      if (row) await prisma.customer.update({ where: { id }, data: row });
      break;
    }
    case 'Lead': {
      const row = await prisma.lead.findUnique({ where: { id }, select: { contactEmail: true, contactPhone: true, scoreReason: true } });
      if (row) await prisma.lead.update({ where: { id }, data: row });
      break;
    }
    case 'Task': {
      const row = await prisma.task.findUnique({ where: { id }, select: { description: true } });
      if (row) await prisma.task.update({ where: { id }, data: row });
      break;
    }
    case 'Activity': {
      const row = await prisma.activity.findUnique({ where: { id }, select: { summary: true, metadata: true } });
      if (row) await prisma.activity.update({ where: { id }, data: { summary: row.summary, metadata: row.metadata as Prisma.InputJsonValue } });
      break;
    }
    case 'Note': {
      const row = await prisma.note.findUnique({ where: { id }, select: { body: true } });
      if (row) await prisma.note.update({ where: { id }, data: row });
      break;
    }
    case 'EmailLog': {
      const row = await prisma.emailLog.findUnique({ where: { id }, select: { subject: true, body: true, fromAddr: true, toAddr: true } });
      if (row) await prisma.emailLog.update({ where: { id }, data: row });
      break;
    }
    case 'Attachment': {
      const row = await prisma.attachment.findUnique({ where: { id }, select: { originalName: true } });
      if (row) await prisma.attachment.update({ where: { id }, data: row });
      break;
    }
    case 'Notification': {
      const row = await prisma.notification.findUnique({ where: { id }, select: { title: true, body: true } });
      if (row) await prisma.notification.update({ where: { id }, data: row });
      break;
    }
    case 'AiInsight': {
      const row = await prisma.aiInsight.findUnique({ where: { id }, select: { content: true } });
      if (row) await prisma.aiInsight.update({ where: { id }, data: row });
      break;
    }
    case 'AuditLog': {
      const row = await prisma.auditLog.findUnique({ where: { id }, select: { metadata: true } });
      if (row && row.metadata !== null) await prisma.auditLog.update({ where: { id }, data: { metadata: row.metadata as Prisma.InputJsonValue } });
      break;
    }
  }
}

export async function backfillSensitiveFieldEncryption(): Promise<Record<string, number>> {
  if (!env.FIELD_ENCRYPTION_ENABLED || !env.secretCipher) throw new Error('Sensitive-field encryption is not configured');
  return runWithDatabaseSecurityContext(
    { requestId: 'database-encryption-backfill', allowDeleted: true },
    async () => {
      const totals: Record<string, number> = {};
      for (const target of backfillCandidates(env.secretCipher!.currentKeyId)) {
        totals[target.model] = 0;
        let previousBatch = '';
        while (true) {
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT "id" FROM "${target.model}" WHERE (${target.condition}) ORDER BY "id" LIMIT $1`,
            BATCH_SIZE,
          );
          if (rows.length === 0) break;
          const batchSignature = rows.map(({ id }) => id).join(',');
          if (batchSignature === previousBatch) throw new Error(`Encryption backfill made no progress for ${target.model}`);
          previousBatch = batchSignature;
          for (let offset = 0; offset < rows.length; offset += 20) {
            await Promise.all(rows.slice(offset, offset + 20).map((row) => backfillRecord(target.model, row.id)));
          }
          totals[target.model] += rows.length;
        }
        logger.info({ event: 'database.field_encryption_model_backfilled', model: target.model, count: totals[target.model] }, 'Sensitive model backfill completed');
      }
      logger.info({ event: 'database.field_encryption_backfill_completed', totals }, 'Sensitive-field encryption backfill completed');
      return totals;
    },
  );
}

async function main() {
  try {
    await prisma.$connect();
    await backfillSensitiveFieldEncryption();
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    logger.error({
      event: 'database.field_encryption_backfill_failed',
      errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      reason: error instanceof Error && error.message.startsWith('Encryption backfill') ? error.message : undefined,
    }, 'Sensitive-field encryption backfill failed');
    process.exitCode = 1;
  });
}
