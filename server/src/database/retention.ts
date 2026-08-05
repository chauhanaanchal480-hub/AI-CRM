import { env } from '../config/env.js';
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger.js';
import fs from 'node:fs';
import path from 'node:path';

const POLICY_VERSION = '2.8.0';
const ADVISORY_LOCK_KEY = 2_848_000_001n;
const retentionPrisma = new PrismaClient({
  datasources: { db: { url: env.RETENTION_DATABASE_URL || env.DATABASE_URL } },
});

const softDeleteTables = [
  'AiInsight', 'Notification', 'Attachment', 'EmailLog', 'Note', 'Activity', 'Task', 'Deal', 'Lead', 'Customer',
] as const;

export interface RetentionSummary {
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  deletedCounts: Record<string, number>;
}

export async function runDataRetention(): Promise<RetentionSummary> {
  if (!env.DATA_RETENTION_ENABLED) return { status: 'SKIPPED', deletedCounts: {} };
  const now = new Date();
  const softDeleteCutoff = new Date(now.getTime() - env.SOFT_DELETE_RETENTION_DAYS * 86_400_000);
  const auditCutoff = new Date(now.getTime() - env.AUDIT_RETENTION_DAYS * 86_400_000);
  const authCutoff = new Date(now.getTime() - env.AUTH_RETENTION_DAYS * 86_400_000);
  const runCutoff = new Date(now.getTime() - env.RETENTION_RUN_RETENTION_DAYS * 86_400_000);

  try {
    const result = await retentionPrisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked`;
      if (!lock[0]?.locked) return { status: 'SKIPPED' as const, deletedCounts: {}, attachmentFiles: [] as string[] };
      const run = await tx.dataRetentionRun.create({ data: { policyVersion: POLICY_VERSION, status: 'RUNNING' } });
      const deletedCounts: Record<string, number> = {};
      const attachmentFiles = await tx.$queryRaw<{ filename: string }[]>`
        SELECT "filename" FROM "Attachment" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < ${softDeleteCutoff}
      `;
      for (const table of softDeleteTables) {
        const count = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < $1`,
          softDeleteCutoff,
        );
        deletedCounts[table] = count;
      }
      const statements: ReadonlyArray<[string, string]> = [
        ['ApiRequestNonce', `DELETE FROM "ApiRequestNonce" WHERE "expiresAt" < $1`],
        ['ApiIdempotencyRecord', `DELETE FROM "ApiIdempotencyRecord" WHERE "expiresAt" < $1`],
        ['MfaChallenge', `DELETE FROM "MfaChallenge" WHERE "expiresAt" < $1`],
        ['TrustedDevice', `DELETE FROM "TrustedDevice" WHERE "expiresAt" < $1`],
        ['RefreshToken', `DELETE FROM "RefreshToken" WHERE "expiresAt" < $1 OR "revokedAt" < $2`],
        ['Session', `DELETE FROM "Session" WHERE "expiresAt" < $1 OR "absoluteExpiresAt" < $1`],
        ['LoginHistory', `DELETE FROM "LoginHistory" WHERE "timestamp" < $1`],
        ['AuditLog', `DELETE FROM "AuditLog" WHERE "timestamp" < $1`],
        ['DataRetentionRun', `DELETE FROM "DataRetentionRun" WHERE "startedAt" < $1`],
      ];
      for (const [name, sql] of statements) {
        const count = name === 'RefreshToken'
          ? await tx.$executeRawUnsafe(sql, authCutoff, authCutoff)
          : await tx.$executeRawUnsafe(
              sql,
              ['ApiRequestNonce', 'ApiIdempotencyRecord'].includes(name)
                ? now
                : name === 'AuditLog'
                  ? auditCutoff
                  : name === 'DataRetentionRun'
                    ? runCutoff
                    : authCutoff,
            );
        deletedCounts[name] = count;
      }
      await tx.dataRetentionRun.update({ where: { id: run.id }, data: { completedAt: now, status: 'COMPLETED', deletedCounts } });
      return { status: 'COMPLETED' as const, deletedCounts, attachmentFiles: attachmentFiles.map(({ filename }) => filename) };
    });
    let failedFilePurges = 0;
    const uploadDirectory = path.resolve(env.UPLOAD_DIR);
    for (const filename of result.attachmentFiles) {
      const file = path.resolve(uploadDirectory, path.basename(filename));
      if (path.dirname(file) !== uploadDirectory) {
        failedFilePurges += 1;
        continue;
      }
      try {
        await fs.promises.rm(file, { force: true });
      } catch {
        failedFilePurges += 1;
      }
    }
    if (failedFilePurges > 0) logger.warn({ event: 'database.retention_file_purge_incomplete', failedCount: failedFilePurges }, 'Some retained upload files could not be purged');
    logger.info({ event: 'database.retention_completed', policyVersion: POLICY_VERSION, deletedCounts: result.deletedCounts }, 'Data retention policy completed');
    return { status: result.status, deletedCounts: result.deletedCounts };
  } catch (error) {
    try {
      await retentionPrisma.dataRetentionRun.create({
        data: {
          policyVersion: POLICY_VERSION,
          status: 'FAILED',
          completedAt: new Date(),
          errorCode: error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN',
        },
      });
    } catch {
      // The structured application log remains the fallback when the database is unavailable.
    }
    logger.error({
      event: 'database.retention_failed',
      errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      databaseCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined,
    }, 'Data retention policy failed');
    return { status: 'FAILED', deletedCounts: {} };
  }
}

export function startRetentionScheduler() {
  if (!env.DATA_RETENTION_ENABLED) return undefined;
  const interval = setInterval(() => void runDataRetention(), env.DATA_RETENTION_INTERVAL_HOURS * 3_600_000);
  interval.unref();
  return interval;
}

export function disconnectRetentionDatabase() {
  return retentionPrisma.$disconnect();
}
