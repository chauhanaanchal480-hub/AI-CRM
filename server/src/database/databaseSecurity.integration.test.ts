import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { isEncryptedSecret } from '../security/secrets.js';
import { runWithDatabaseSecurityContext } from './securityContext.js';
import { backfillSensitiveFieldEncryption } from './encryptionBackfill.js';

test('Prisma security layer encrypts storage and soft-deletes without changing returned data', async (context) => {
  if (!env.secretCipher) return context.skip('Encryption keyring is not configured');
  const raw = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const owner = await raw.user.findFirst({ select: { id: true } });
  assert.ok(owner);
  const unique = `${Date.now()}-${process.pid}`;
  const customer = await prisma.customer.create({
    data: {
      name: `Security Test ${unique}`,
      email: `security-${unique}@example.com`,
      phone: '+1 555 0199',
      ownerId: owner.id,
    },
  });
  try {
    assert.equal(customer.email, `security-${unique}@example.com`);
    const stored = await raw.customer.findUnique({ where: { id: customer.id } });
    assert.ok(stored);
    assert.equal(isEncryptedSecret(stored.email ?? undefined), true);
    assert.equal(isEncryptedSecret(stored.phone ?? undefined), true);
    assert.ok(stored.emailSearchTokens.length > 0);

    await runWithDatabaseSecurityContext(
      { requestId: `security-test-${unique}`, actorId: owner.id },
      async () => prisma.customer.delete({ where: { id: customer.id } }),
    );
    assert.equal(await prisma.customer.findUnique({ where: { id: customer.id } }), null);
    const retained = await runWithDatabaseSecurityContext(
      { requestId: `security-maintenance-${unique}`, allowDeleted: true },
      async () => prisma.customer.findUnique({ where: { id: customer.id } }),
    );
    assert.equal(retained?.email, `security-${unique}@example.com`);
    const deleted = await raw.customer.findUnique({ where: { id: customer.id } });
    assert.ok(deleted?.deletedAt);
    assert.equal(deleted.deletedById, owner.id);
  } finally {
    await raw.customer.deleteMany({ where: { id: customer.id } });
    await raw.$disconnect();
  }
});

test('encryption backfill includes retained soft-deleted records', async (context) => {
  if (!env.secretCipher) return context.skip('Encryption keyring is not configured');
  const raw = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const owner = await raw.user.findFirst({ select: { id: true } });
  assert.ok(owner);
  const unique = `${Date.now()}-${process.pid}`;
  const customer = await raw.customer.create({
    data: {
      name: `Retained Security Test ${unique}`,
      email: `retained-${unique}@example.com`,
      phone: '+1 555 0198',
      ownerId: owner.id,
      deletedAt: new Date(),
    },
  });
  try {
    await backfillSensitiveFieldEncryption();
    const stored = await raw.customer.findUnique({ where: { id: customer.id } });
    assert.ok(stored);
    assert.equal(isEncryptedSecret(stored.email ?? undefined), true);
    assert.equal(isEncryptedSecret(stored.phone ?? undefined), true);
    assert.ok(stored.emailSearchTokens.length > 0);
    assert.equal(await prisma.customer.findUnique({ where: { id: customer.id } }), null);
  } finally {
    await raw.customer.deleteMany({ where: { id: customer.id } });
    await raw.$disconnect();
  }
});
