/* eslint-disable no-console */
import { PrismaClient, Role, CustomerStatus, LeadStatus, LeadSource, DealStatus, TaskStatus, Priority, ActivityType, EmailDirection, InsightKind } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Deterministic pseudo-random so seeds are reproducible across runs.
let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function main() {
  console.log('🌱 Seeding database…');

  // Clean (respecting FK order)
  await prisma.aiInsight.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.stage.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash('Password123!', 10);

  // ── Users ──────────────────────────────────────────────
  const admin = await prisma.user.create({
    data: { email: 'admin@crm.dev', passwordHash: password, firstName: 'Ava', lastName: 'Reynolds', role: Role.ADMIN, title: 'Head of Revenue', phone: '+1 415 555 0100' },
  });
  const manager = await prisma.user.create({
    data: { email: 'manager@crm.dev', passwordHash: password, firstName: 'Marcus', lastName: 'Lee', role: Role.SALES_MANAGER, title: 'Sales Manager', phone: '+1 415 555 0111' },
  });
  const emp1 = await prisma.user.create({
    data: { email: 'sam@crm.dev', passwordHash: password, firstName: 'Sam', lastName: 'Patel', role: Role.EMPLOYEE, title: 'Account Executive', phone: '+1 415 555 0122' },
  });
  const emp2 = await prisma.user.create({
    data: { email: 'nina@crm.dev', passwordHash: password, firstName: 'Nina', lastName: 'Okafor', role: Role.EMPLOYEE, title: 'Sales Representative', phone: '+1 415 555 0133' },
  });
  const reps = [admin, manager, emp1, emp2];
  console.log(`  ✓ ${reps.length} users`);

  // ── Pipeline + stages ──────────────────────────────────
  const pipeline = await prisma.pipeline.create({ data: { name: 'Sales Pipeline', isDefault: true } });
  const stageDefs = [
    { name: 'Lead In', order: 0, color: '#64748b' },
    { name: 'Qualified', order: 1, color: '#6366f1' },
    { name: 'Proposal', order: 2, color: '#a855f7' },
    { name: 'Negotiation', order: 3, color: '#f59e0b' },
    { name: 'Closed Won', order: 4, color: '#10b981' },
  ];
  const stages = [];
  for (const s of stageDefs) {
    stages.push(await prisma.stage.create({ data: { ...s, pipelineId: pipeline.id } }));
  }
  console.log(`  ✓ pipeline with ${stages.length} stages`);

  // ── Customers ──────────────────────────────────────────
  const companies = [
    ['Acme Corp', 'Wade Warren', 'wade@acme.io', 'San Francisco', 'USA'],
    ['Globex', 'Esther Howard', 'esther@globex.com', 'Austin', 'USA'],
    ['Initech', 'Cameron Williamson', 'cam@initech.com', 'Denver', 'USA'],
    ['Umbrella Ltd', 'Brooklyn Simmons', 'brooklyn@umbrella.co', 'London', 'UK'],
    ['Soylent Inc', 'Leslie Alexander', 'leslie@soylent.com', 'Toronto', 'Canada'],
    ['Hooli', 'Guy Hawkins', 'guy@hooli.com', 'Palo Alto', 'USA'],
    ['Vehement Capital', 'Robert Fox', 'robert@vehement.vc', 'New York', 'USA'],
    ['Massive Dynamic', 'Kristin Watson', 'kristin@massive.com', 'Boston', 'USA'],
    ['Stark Industries', 'Jacob Jones', 'jacob@stark.com', 'Berlin', 'Germany'],
    ['Wayne Enterprises', 'Courtney Henry', 'courtney@wayne.com', 'Gotham', 'USA'],
    ['Cyberdyne', 'Dianne Russell', 'dianne@cyberdyne.ai', 'Sydney', 'Australia'],
    ['Wonka Industries', 'Ralph Edwards', 'ralph@wonka.com', 'Chicago', 'USA'],
    ['Tyrell Corporation', 'Eldon Tyrell', 'eldon@tyrell.com', 'Los Angeles', 'USA'],
  ];
  const tagPool = ['enterprise', 'smb', 'priority', 'renewal', 'inbound', 'strategic', 'trial'];
  const customers = [];
  for (let i = 0; i < companies.length; i++) {
    const [company, name, email, city, country] = companies[i];
    const c = await prisma.customer.create({
      data: {
        name, company, email,
        phone: `+1 415 555 0${200 + i}`,
        status: pick([CustomerStatus.LEAD, CustomerStatus.ACTIVE, CustomerStatus.ACTIVE, CustomerStatus.INACTIVE]),
        tags: [pick(tagPool), pick(tagPool)].filter((v, idx, a) => a.indexOf(v) === idx),
        website: `https://${company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        city, country,
        ownerId: pick(reps).id,
        createdAt: daysAgo(Math.floor(rand() * 120) + 10),
      },
    });
    customers.push(c);
  }
  console.log(`  ✓ ${customers.length} customers`);

  // ── Leads ──────────────────────────────────────────────
  const leadTitles = ['Website demo request', 'Enterprise plan inquiry', 'Referral from partner', 'Trial signup follow-up', 'Conference lead', 'Pricing question', 'Integration interest'];
  let leadCount = 0;
  for (const c of customers) {
    const n = Math.floor(rand() * 2) + 1;
    for (let i = 0; i < n; i++) {
      await prisma.lead.create({
        data: {
          title: pick(leadTitles),
          status: pick([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.UNQUALIFIED, LeadStatus.CONVERTED]),
          source: pick([LeadSource.WEBSITE, LeadSource.REFERRAL, LeadSource.COLD_CALL, LeadSource.EVENT, LeadSource.SOCIAL, LeadSource.EMAIL_CAMPAIGN]),
          value: Math.floor(rand() * 45000) + 5000,
          contactName: c.name,
          contactEmail: c.email,
          customerId: c.id,
          assignedToId: pick(reps).id,
          createdAt: daysAgo(Math.floor(rand() * 90)),
        },
      });
      leadCount++;
    }
  }
  console.log(`  ✓ ${leadCount} leads`);

  // ── Deals ──────────────────────────────────────────────
  const dealTitles = ['Annual subscription', 'Platform expansion', 'Multi-seat rollout', 'Premium upgrade', 'Pilot program', 'Renewal + upsell'];
  let dealCount = 0;
  const positionByStage: Record<string, number> = {};
  for (const c of customers) {
    const n = Math.floor(rand() * 2) + 1;
    for (let i = 0; i < n; i++) {
      const stage = pick(stages);
      const isWon = stage.name === 'Closed Won';
      positionByStage[stage.id] = (positionByStage[stage.id] ?? 0) + 1;
      const deal = await prisma.deal.create({
        data: {
          title: pick(dealTitles),
          value: Math.floor(rand() * 90000) + 10000,
          status: isWon ? DealStatus.WON : pick([DealStatus.OPEN, DealStatus.OPEN, DealStatus.OPEN, DealStatus.LOST]),
          probability: isWon ? 100 : Math.floor(rand() * 80) + 10,
          position: positionByStage[stage.id],
          expectedCloseDate: daysAgo(-(Math.floor(rand() * 60) + 5)),
          closedAt: isWon ? daysAgo(Math.floor(rand() * 20)) : null,
          stageId: stage.id,
          customerId: c.id,
          ownerId: c.ownerId,
          createdAt: daysAgo(Math.floor(rand() * 80) + 5),
        },
      });
      dealCount++;

      // Activity: deal created
      await prisma.activity.create({
        data: { type: ActivityType.DEAL_UPDATE, summary: `Deal "${deal.title}" created at ${stage.name}`, userId: c.ownerId, customerId: c.id, dealId: deal.id, createdAt: deal.createdAt },
      });
    }
  }
  console.log(`  ✓ ${dealCount} deals`);

  // ── Activities, emails, notes, insights per customer ───
  const emailSubjects = ['Following up on our call', 'Proposal attached', 'Quick question about pricing', 'Re: next steps', 'Thanks for your time', 'Checking in'];
  const noteBodies = ['Very interested in the enterprise tier. Budget approved for Q3.', 'Prefers a call over email. Best reached mornings PT.', 'Concerned about migration effort — send case study.', 'Champion internally is the VP of Ops.', 'Competitor eval in progress; decision in 3 weeks.'];
  for (const c of customers) {
    const touches = Math.floor(rand() * 4) + 2;
    for (let i = 0; i < touches; i++) {
      const type = pick([ActivityType.CALL, ActivityType.MEETING, ActivityType.EMAIL, ActivityType.NOTE]);
      await prisma.activity.create({
        data: { type, summary: `${type[0] + type.slice(1).toLowerCase()} with ${c.name}`, userId: c.ownerId, customerId: c.id, createdAt: daysAgo(Math.floor(rand() * 40)) },
      });
    }
    const emailN = Math.floor(rand() * 3) + 1;
    for (let i = 0; i < emailN; i++) {
      const dir = pick([EmailDirection.OUTBOUND, EmailDirection.INBOUND]);
      await prisma.emailLog.create({
        data: {
          subject: pick(emailSubjects),
          body: 'Hi, thanks for the update. Let me loop in my team and get back to you shortly with next steps.',
          direction: dir,
          fromAddr: dir === EmailDirection.OUTBOUND ? 'sales@crm.dev' : (c.email ?? 'contact@example.com'),
          toAddr: dir === EmailDirection.OUTBOUND ? (c.email ?? 'contact@example.com') : 'sales@crm.dev',
          customerId: c.id,
          userId: c.ownerId,
          sentAt: daysAgo(Math.floor(rand() * 30)),
        },
      });
    }
    await prisma.note.create({
      data: { body: pick(noteBodies), customerId: c.id, userId: c.ownerId, createdAt: daysAgo(Math.floor(rand() * 25)) },
    });
    await prisma.aiInsight.create({
      data: { kind: InsightKind.SUMMARY, content: `${c.name} is actively engaged with several touchpoints this month. Relationship is warm; prioritise a proposal.`, customerId: c.id },
    });
  }
  console.log('  ✓ activities, emails, notes, insights');

  // ── Tasks ──────────────────────────────────────────────
  const taskTitles = ['Send proposal', 'Follow up on demo', 'Schedule kickoff call', 'Prepare contract', 'Review requirements', 'Send case study', 'Confirm budget'];
  let taskCount = 0;
  for (const c of customers) {
    const n = Math.floor(rand() * 2) + 1;
    for (let i = 0; i < n; i++) {
      await prisma.task.create({
        data: {
          title: pick(taskTitles),
          description: `Action item for ${c.company ?? c.name}.`,
          status: pick([TaskStatus.TODO, TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE]),
          priority: pick([Priority.LOW, Priority.MEDIUM, Priority.HIGH]),
          dueDate: daysAgo(-(Math.floor(rand() * 14) + 1)),
          assigneeId: c.ownerId,
          customerId: c.id,
        },
      });
      taskCount++;
    }
  }
  console.log(`  ✓ ${taskCount} tasks`);

  // ── Notifications ──────────────────────────────────────
  for (const u of reps) {
    await prisma.notification.create({
      data: { userId: u.id, type: 'welcome', title: 'Welcome to AI-CRM', body: 'Your workspace is ready. Explore the dashboard to get started.', read: false },
    });
    await prisma.notification.create({
      data: { userId: u.id, type: 'task', title: 'You have tasks due this week', body: 'Check the Tasks page for upcoming deadlines.', read: rand() > 0.5 },
    });
  }
  console.log('  ✓ notifications');

  console.log('\n✅ Seed complete. Login with:');
  console.log('   admin@crm.dev   / Password123!  (ADMIN)');
  console.log('   manager@crm.dev / Password123!  (SALES_MANAGER)');
  console.log('   sam@crm.dev     / Password123!  (EMPLOYEE)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
