import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Customer support against a real PostgreSQL database: unique numbers under
 * concurrent submissions, double-submit handling, requesters confined to
 * their own tickets (same store and across stores, owner and staff alike),
 * internal notes never reaching a requester, the status workflow enforced
 * on the server, store clients locked out of the support tables, and missing
 * notifications raised again by the daily sync.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only. Needs every migration applied (including
 * 20261031090000_customer_support) and bootstrap run.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('support (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run support tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;
  process.env.BETTER_AUTH_SECRET ??= 'integration-test-secret-at-least-32-chars';

  const run = randomBytes(4).toString('hex');
  let platform: PrismaClient;
  let support: typeof import('@/server/support/support-service');
  let admin: typeof import('@/server/support/support-admin-service');
  let notify: typeof import('@/server/support/support-notify');
  let storeClient: (storeId: string) => PrismaClient;

  type Person = { id: string; name: string; store: { id: string } | null };
  let ownerA: Person;
  let cashierA: Person;
  let ownerB: Person;
  let adminUser: { id: string; name: string };

  const key = () => randomBytes(12).toString('hex');
  const ticket = (subject = 'Receipt prints twice') => ({
    category: 'BUG_REPORT' as const,
    subject,
    description: 'When I press print, the receipt comes out twice.',
    submissionKey: key(),
  });

  async function seedStore(tag: string) {
    const storeId = `sup_${tag}_${run}`;
    await platform.store.create({ data: { id: storeId, name: `Support ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE' } });
    const ownerRole = await platform.role.create({ data: { storeId, name: 'Owner', slug: 'owner' }, select: { id: true } });
    const cashierRole = await platform.role.create({ data: { storeId, name: 'Cashier', slug: 'cashier' }, select: { id: true } });
    const person = async (who: string, roleId: string): Promise<Person> => {
      const username = `${who}${tag}${run}`.toLowerCase();
      const user = await platform.user.create({
        data: { storeId, name: `${who} ${tag}`, email: `${username}@support.test`, username, roleId },
        select: { id: true, name: true },
      });
      return { ...user, store: { id: storeId } };
    };
    const owner = await person('owner', ownerRole.id);
    await platform.store.update({ where: { id: storeId }, data: { ownerId: owner.id } });
    return { storeId, owner, cashier: await person('cashier', cashierRole.id), newStaff: (who: string) => person(who, cashierRole.id) };
  }

  /** A requester of their own, so the per-account hourly limit never couples two tests. */
  let newStaffA: (who: string) => Promise<Person>;
  let counter = 0;
  const fresh = () => newStaffA(`staff${(counter += 1)}`);

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    support = await import('@/server/support/support-service');
    admin = await import('@/server/support/support-admin-service');
    notify = await import('@/server/support/support-notify');
    ({ storeClient } = await import('@/lib/tenant/client'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const A = await seedStore('a');
    const B = await seedStore('b');
    ownerA = A.owner;
    cashierA = A.cashier;
    ownerB = B.owner;
    newStaffA = A.newStaff;
    const role = await platform.role.findFirstOrThrow({ where: { slug: 'system-admin', storeId: null }, select: { id: true } });
    adminUser = await platform.user.create({
      data: { name: `Support admin ${run}`, email: `sa${run}@support.test`, username: `sa${run}`, roleId: role.id },
      select: { id: true, name: true },
    });
  });

  after(async () => {
    await platform.$disconnect();
  });

  describe('creating tickets', () => {
    test('concurrent submissions get distinct numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => support.createTicket(ownerA, ticket(`Parallel ${i}`), { ipHash: null })),
      );
      const numbers = results.map((result) => result.number);
      assert.equal(new Set(numbers).size, numbers.length);
      for (const number of numbers) assert.match(number, /^SUP-\d{6,}$/);
    });

    test('the same submission sent twice is stored once', async () => {
      const input = ticket('Double click');
      const [first, second] = await Promise.all([
        support.createTicket(ownerA, input, { ipHash: null }),
        support.createTicket(ownerA, input, { ipHash: null }),
      ]);
      assert.equal(first.number, second.number);
      assert.equal(await platform.supportTicket.count({ where: { submissionKey: input.submissionKey } }), 1);
    });

    test('a submission key belonging to someone else is refused, not answered with their ticket', async () => {
      const input = ticket('Mine');
      await support.createTicket(ownerA, input, { ipHash: null });
      await assert.rejects(support.createTicket(ownerB, input, { ipHash: null }));
    });

    test('the store is the requester’s own and the priority comes from the category', async () => {
      const { number } = await support.createTicket(cashierA, { ...ticket('Billing'), category: 'BILLING' }, { ipHash: null });
      const row = await platform.supportTicket.findUniqueOrThrow({ where: { number } });
      assert.equal(row.storeId, cashierA.store?.id);
      assert.equal(row.requesterId, cashierA.id);
      assert.equal(row.priority, 'HIGH');
      assert.equal(row.status, 'NEW');
    });

    test('a new ticket notifies the administrators, and a lost notification is raised again by the sync', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Notify me'), { ipHash: null });
      const row = await platform.supportTicket.findUniqueOrThrow({ where: { number }, select: { id: true } });
      const dedupeKey = `support:${row.id}:created`;
      assert.equal(await platform.platformNotification.count({ where: { dedupeKey } }), 1);
      await platform.platformNotification.deleteMany({ where: { dedupeKey } });
      await notify.syncSupportNotifications(new Date());
      assert.equal(await platform.platformNotification.count({ where: { dedupeKey } }), 1);
    });

    test('an account is limited to ten tickets an hour', async () => {
      const me = await fresh();
      for (let i = 0; i < 10; i += 1) await support.createTicket(me, ticket(`Limit ${i}`), { ipHash: null });
      await assert.rejects(support.createTicket(me, ticket('Eleventh'), { ipHash: null }), /too many/i);
    });

    test('public submissions are limited per reply address', async () => {
      const email = `limit${run}@public.test`;
      for (let i = 0; i < 5; i += 1) {
        await support.createPublicTicket({ ...ticket(`Public ${i}`), name: 'Visitor', email }, { ipHash: null });
      }
      await assert.rejects(support.createPublicTicket({ ...ticket('One too many'), name: 'Visitor', email }, { ipHash: null }));
      const rows = await platform.supportTicket.findMany({ where: { replyEmail: email }, select: { requesterId: true, storeId: true, source: true } });
      assert.ok(rows.every((r) => r.requesterId === null && r.storeId === null && r.source === 'PUBLIC'), 'never linked to an account');
    });
  });

  describe('who can see what', () => {
    test('requesters only see their own tickets: not a colleague’s, not their owner’s, not another store’s', async () => {
      const { number } = await support.createTicket(cashierA, ticket('Private to the cashier'), { ipHash: null });
      assert.ok(await support.getMyTicket(cashierA.id, number));
      assert.equal(await support.getMyTicket(ownerA.id, number), null, 'the owner does not see a staff ticket');
      assert.equal(await support.getMyTicket(ownerB.id, number), null, 'another store does not see it');
      await assert.rejects(support.replyToMyTicket(ownerB, number, 'Let me in'), /not found/i);
      const list = await support.listMyTickets(ownerB.id, 'all', 1);
      assert.ok(!list.items.some((item) => item.number === number));
    });

    test('internal notes never reach the requester', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('With a note'), { ipHash: null });
      await admin.addInternalNote(adminUser, number, 'Owner sounds upset; check their printer driver.');
      await admin.replyAsAdmin(adminUser, number, 'Thanks, we are looking into it.', { waitForUser: false });
      const mine = await support.getMyTicket(me.id, number);
      assert.ok(mine);
      assert.ok(mine.messages.every((message) => message.visibility === 'PUBLIC'));
      assert.ok(!mine.messages.some((message) => message.body.includes('printer driver')));
      const full = await admin.getTicketForAdmin(number);
      assert.ok(full?.messages.some((message) => message.visibility === 'INTERNAL'));
    });

    test('an attachment is only found for its own requester', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Attachment'), { ipHash: null });
      const row = await platform.supportTicket.findUniqueOrThrow({ where: { number }, include: { messages: true } });
      const file = await platform.supportAttachment.create({
        data: {
          ticketId: row.id, messageId: row.messages[0].id, storagePath: `tickets/${row.id}/${run}.png`,
          originalName: 'shot.png', mimeType: 'image/png', sizeBytes: 10, uploadedById: me.id,
        },
      });
      assert.ok(await support.findMyAttachment(me.id, file.id));
      assert.equal(await support.findMyAttachment(cashierA.id, file.id), null);
      assert.equal(await support.findMyAttachment(ownerA.id, file.id), null, 'not even the store owner');
      assert.equal(await support.findMyAttachment(ownerB.id, file.id), null);
      assert.ok(await admin.findAttachmentForAdmin(file.id));
    });

    test('a store client cannot reach the support tables at all', async () => {
      const db = storeClient(ownerA.store!.id);
      await assert.rejects(db.supportTicket.findMany({ take: 1 }));
      await assert.rejects(db.supportMessage.findMany({ take: 1 }));
      await assert.rejects(db.supportAttachment.findMany({ take: 1 }));
    });
  });

  describe('status workflow', () => {
    test('waiting for the user, a user reply returns it to support; resolved reopens on reply', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Workflow'), { ipHash: null });
      await admin.replyAsAdmin(adminUser, number, 'Which printer do you use?', { waitForUser: true });
      assert.equal((await admin.getTicketForAdmin(number))?.status, 'WAITING_FOR_USER');
      assert.ok((await support.listMyTickets(me.id, 'all', 1)).items.find((t) => t.number === number)?.unreadReply);

      assert.equal((await support.replyToMyTicket(me, number, 'An Epson TM-T82.')).status, 'OPEN');
      await admin.changeStatus(adminUser, number, 'RESOLVED', 'OPEN');
      assert.equal((await support.replyToMyTicket(me, number, 'Still happens.')).status, 'OPEN');
    });

    test('a closed ticket refuses requester and administrator replies until it is reopened', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Closing'), { ipHash: null });
      await admin.changeStatus(adminUser, number, 'CLOSED', 'NEW');
      await assert.rejects(support.replyToMyTicket(me, number, 'Hello?'), /closed/i);
      await assert.rejects(admin.replyAsAdmin(adminUser, number, 'Hi', { waitForUser: false }), /closed/i);
      await admin.changeStatus(adminUser, number, 'OPEN', 'CLOSED');
      assert.equal((await support.replyToMyTicket(me, number, 'Thanks')).status, 'OPEN');
    });

    test('moves the workflow does not allow, and moves from a stale status, are refused', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Invalid moves'), { ipHash: null });
      await admin.changeStatus(adminUser, number, 'CLOSED', 'NEW');
      await assert.rejects(admin.changeStatus(adminUser, number, 'RESOLVED', 'CLOSED'));
      await assert.rejects(admin.changeStatus(adminUser, number, 'IN_PROGRESS', 'NEW'), /just changed/i);
    });

    test('tickets can only be assigned to an active platform administrator', async () => {
      const me = await fresh();
      const { number } = await support.createTicket(me, ticket('Assign'), { ipHash: null });
      await assert.rejects(admin.assignTicket(adminUser, number, me.id));
      await admin.assignTicket(adminUser, number, adminUser.id);
      assert.equal((await admin.getTicketForAdmin(number))?.assignee?.id, adminUser.id);
    });

    test('the inbox counts come from the tickets', async () => {
      const before = await admin.inboxSummary();
      await support.createTicket(ownerB, ticket('Counted'), { ipHash: null });
      const after = await admin.inboxSummary();
      assert.equal(after.new, before.new + 1);
      assert.equal(after.awaiting, before.awaiting + 1);
    });
  });
}
