import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Role } from '@prisma/client';
import { env } from '../config/env.js';
import { customersService } from './customers/customers.service.js';
import { leadsService } from './leads/leads.service.js';

const raw = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const suffix = `${Date.now()}-${process.pid}`;
const customerCreateName = `Transaction Customer Create ${suffix}`;
const customerUpdateName = `Transaction Customer Update ${suffix}`;
const leadCreateTitle = `Transaction Lead Create ${suffix}`;
const leadUpdateTitle = `Transaction Lead Update ${suffix}`;
const conversionTitle = `Transaction Lead Conversion ${suffix}`;

type Owner = { id: string; role: Role };
let owner: Owner;
const failingActor = () => ({ id: randomUUID(), role: 'MANAGER' as const });

test.before(async (context) => {
  owner = (await raw.user.findFirst({ select: { id: true, role: true } })) as Owner;
  if (!owner) context.skip('A seeded user is required for transaction integration tests');
});

test.after(async () => {
  await raw.lead.deleteMany({
    where: { title: { in: [leadCreateTitle, leadUpdateTitle, conversionTitle] } },
  });
  await raw.customer.deleteMany({
    where: { name: { in: [customerCreateName, customerUpdateName] } },
  });
  await raw.$disconnect();
});

test('customer create rolls back when Activity creation fails', async () => {
  await assert.rejects(
    customersService.create(failingActor(), {
      name: customerCreateName,
      ownerId: owner.id,
    }),
  );

  assert.equal(
    await raw.customer.count({ where: { name: customerCreateName } }),
    0,
  );
});

test('customer update rolls back when Activity creation fails', async () => {
  const customer = await raw.customer.create({
    data: { name: customerUpdateName, ownerId: owner.id },
  });

  await assert.rejects(
    customersService.update(failingActor(), customer.id, { name: `${customerUpdateName} changed` }),
  );

  const unchanged = await raw.customer.findUnique({ where: { id: customer.id } });
  assert.equal(unchanged?.name, customerUpdateName);
});

test('lead create rolls back when Activity creation fails', async () => {
  await assert.rejects(
    leadsService.create(failingActor(), {
      title: leadCreateTitle,
      assignedToId: owner.id,
    }),
  );

  assert.equal(
    await raw.lead.count({ where: { title: leadCreateTitle } }),
    0,
  );
});

test('lead update rolls back when Activity creation fails', async () => {
  const lead = await raw.lead.create({
    data: { title: leadUpdateTitle, assignedToId: owner.id },
  });

  await assert.rejects(
    leadsService.update(failingActor(), lead.id, { title: `${leadUpdateTitle} changed` }),
  );

  const unchanged = await raw.lead.findUnique({ where: { id: lead.id } });
  assert.equal(unchanged?.title, leadUpdateTitle);
});

test('lead conversion rolls back Customer creation and Lead update when Activity creation fails', async () => {
  const lead = await raw.lead.create({
    data: {
      title: conversionTitle,
      contactName: `Conversion Contact ${suffix}`,
      assignedToId: owner.id,
    },
  });

  await assert.rejects(leadsService.convert(failingActor(), lead.id));

  const unchangedLead = await raw.lead.findUnique({ where: { id: lead.id } });
  assert.equal(unchangedLead?.status, 'NEW');
  assert.equal(unchangedLead?.customerId, null);
  assert.equal(
    await raw.customer.count({ where: { name: `Conversion Contact ${suffix}` } }),
    0,
  );
});
