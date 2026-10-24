import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT_STATUSES,
  adminReplyEffect,
  adminTargets,
  awaitingAdmin,
  canAdminTransition,
  cleanText,
  createTicketSchema,
  defaultPriority,
  hasUnreadReply,
  isConsequentialTransition,
  isTicketNumber,
  lifecycleStamps,
  parseAdminInboxQuery,
  parseRequesterFilter,
  publicTicketSchema,
  replySchema,
  requesterFilterStatuses,
  requesterReplyEffect,
} from '@/lib/support';
import { MODEL_SCOPES, StoreScopeError, scopeArgs } from '@/lib/tenant/scope';
import { SYSTEM_ROLES, resolveRolePermissions, ROUTE_PERMISSIONS } from '@/lib/permissions';

/**
 * Customer support rules without a database: the status workflow, what a
 * reply does to a ticket, input cleaning, and that no store client can reach
 * the support tables. Database guarantees (numbering, triggers) are in
 * tests/integration/support.integration.ts.
 */

const key = 'abcdefghijklmnop1234';

test('status workflow: every administrator move is listed, and closing is not a dead end', () => {
  assert.ok(canAdminTransition('NEW', 'OPEN'));
  assert.ok(canAdminTransition('OPEN', 'IN_PROGRESS'));
  assert.ok(canAdminTransition('IN_PROGRESS', 'WAITING_FOR_USER'));
  assert.ok(canAdminTransition('WAITING_FOR_USER', 'RESOLVED'));
  assert.ok(canAdminTransition('RESOLVED', 'CLOSED'));
  assert.ok(canAdminTransition('CLOSED', 'OPEN'), 'an authorised reopen');
  assert.ok(!canAdminTransition('CLOSED', 'RESOLVED'));
  assert.ok(!canAdminTransition('CLOSED', 'IN_PROGRESS'));
  assert.ok(!canAdminTransition('RESOLVED', 'WAITING_FOR_USER'));
  for (const status of SUPPORT_STATUSES) {
    assert.ok(!canAdminTransition(status, status), `${status} to itself is not a change`);
    assert.ok(!adminTargets(status).includes('NEW'), 'nothing goes back to NEW');
  }
});

test('closing, resolving and reopening a closed ticket ask for confirmation', () => {
  assert.ok(isConsequentialTransition('OPEN', 'CLOSED'));
  assert.ok(isConsequentialTransition('IN_PROGRESS', 'RESOLVED'));
  assert.ok(isConsequentialTransition('CLOSED', 'OPEN'));
  assert.ok(!isConsequentialTransition('OPEN', 'IN_PROGRESS'));
});

test('a requester reply returns a waiting or resolved ticket to support, and a closed one refuses it', () => {
  assert.deepEqual(requesterReplyEffect('WAITING_FOR_USER'), { allowed: true, next: 'OPEN' });
  assert.deepEqual(requesterReplyEffect('RESOLVED'), { allowed: true, next: 'OPEN' });
  assert.deepEqual(requesterReplyEffect('IN_PROGRESS'), { allowed: true, next: 'IN_PROGRESS' });
  assert.deepEqual(requesterReplyEffect('NEW'), { allowed: true, next: 'NEW' });
  assert.equal(requesterReplyEffect('CLOSED').allowed, false);
});

test('an administrator reply opens a new ticket, can ask the user for more, and never reaches a closed one', () => {
  assert.deepEqual(adminReplyEffect('NEW', false), { allowed: true, next: 'OPEN' });
  assert.deepEqual(adminReplyEffect('IN_PROGRESS', false), { allowed: true, next: 'IN_PROGRESS' });
  assert.deepEqual(adminReplyEffect('OPEN', true), { allowed: true, next: 'WAITING_FOR_USER' });
  assert.equal(adminReplyEffect('CLOSED', false).allowed, false);
  assert.equal(adminReplyEffect('CLOSED', true).allowed, false);
});

test('resolved and closed timestamps follow the status', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const earlier = new Date('2026-10-20T10:00:00Z');
  assert.deepEqual(lifecycleStamps('RESOLVED', { resolvedAt: null, closedAt: null }, now), { resolvedAt: now, closedAt: null });
  assert.deepEqual(lifecycleStamps('CLOSED', { resolvedAt: earlier, closedAt: null }, now), { resolvedAt: earlier, closedAt: now });
  assert.deepEqual(lifecycleStamps('OPEN', { resolvedAt: earlier, closedAt: now }, now), { resolvedAt: null, closedAt: null });
});

test('priority is set by the system from the category', () => {
  assert.equal(defaultPriority('BILLING'), 'HIGH');
  assert.equal(defaultPriority('ACCOUNT_LOGIN'), 'HIGH');
  assert.equal(defaultPriority('FEATURE_REQUEST'), 'LOW');
  assert.equal(defaultPriority('BUG_REPORT'), 'NORMAL');
  assert.ok(!('priority' in createTicketSchema.shape), 'the form cannot send a priority');
});

test('unread replies and the "awaiting support" queue', () => {
  const t0 = new Date('2026-10-24T08:00:00Z');
  const t1 = new Date('2026-10-24T09:00:00Z');
  assert.equal(hasUnreadReply({ lastAdminReplyAt: null, requesterReadAt: null }), false);
  assert.equal(hasUnreadReply({ lastAdminReplyAt: t1, requesterReadAt: null }), true);
  assert.equal(hasUnreadReply({ lastAdminReplyAt: t1, requesterReadAt: t0 }), true);
  assert.equal(hasUnreadReply({ lastAdminReplyAt: t0, requesterReadAt: t1 }), false);

  assert.equal(awaitingAdmin({ status: 'NEW', lastAdminReplyAt: null, lastRequesterReplyAt: null }), true);
  assert.equal(awaitingAdmin({ status: 'OPEN', lastAdminReplyAt: t0, lastRequesterReplyAt: t1 }), true);
  assert.equal(awaitingAdmin({ status: 'OPEN', lastAdminReplyAt: t1, lastRequesterReplyAt: t0 }), false);
  assert.equal(awaitingAdmin({ status: 'WAITING_FOR_USER', lastAdminReplyAt: null, lastRequesterReplyAt: null }), false);
  assert.equal(awaitingAdmin({ status: 'RESOLVED', lastAdminReplyAt: null, lastRequesterReplyAt: t1 }), false);
});

test('input: text is cleaned, required fields and lengths are enforced', () => {
  assert.equal(cleanText('  hello\r\nworld\u0000\u0007  '), 'hello\nworld');

  const okTicket = createTicketSchema.safeParse({
    category: 'BUG_REPORT',
    subject: '  Receipt   prints\ntwice ',
    description: 'When I press print the receipt comes out twice.',
    submissionKey: key,
  });
  assert.ok(okTicket.success);
  assert.equal(okTicket.success && okTicket.data.subject, 'Receipt prints twice');

  assert.equal(createTicketSchema.safeParse({ category: 'HACK', subject: 'x', description: 'long enough text', submissionKey: key }).success, false);
  assert.equal(createTicketSchema.safeParse({ category: 'GENERAL', subject: '   ', description: 'long enough text', submissionKey: key }).success, false);
  assert.equal(createTicketSchema.safeParse({ category: 'GENERAL', subject: 'Hi', description: 'short', submissionKey: key }).success, false);
  assert.equal(createTicketSchema.safeParse({ category: 'GENERAL', subject: 'x'.repeat(201), description: 'long enough text', submissionKey: key }).success, false);
  assert.equal(createTicketSchema.safeParse({ category: 'GENERAL', subject: 'Hi', description: 'long enough text', submissionKey: 'bad key!' }).success, false);

  const publicInput = {
    category: 'ACCOUNT_LOGIN', subject: 'Cannot sign in', description: 'I forgot my password and the owner is away.',
    submissionKey: key, name: 'Ana', email: '  Ana@Example.COM ',
  };
  const pub = publicTicketSchema.safeParse(publicInput);
  assert.ok(pub.success);
  assert.equal(pub.success && pub.data.email, 'ana@example.com');
  assert.equal(publicTicketSchema.safeParse({ ...publicInput, email: 'not-an-email' }).success, false);
  assert.equal(publicTicketSchema.safeParse({ ...publicInput, name: '' }).success, false);

  assert.equal(replySchema.safeParse({ message: '   ' }).success, false);
  assert.equal(replySchema.safeParse({ message: '<script>alert(1)</script>' }).success, true, 'kept as text, rendered as text');
});

test('ticket numbers and list filters accept only known values', () => {
  assert.ok(isTicketNumber('SUP-000123'));
  assert.ok(!isTicketNumber('SUP-12'));
  assert.ok(!isTicketNumber("SUP-000123' OR 1=1"));
  assert.equal(parseRequesterFilter('RESOLVED'), 'RESOLVED');
  assert.equal(parseRequesterFilter('DROP'), 'all');
  assert.deepEqual(requesterFilterStatuses('OPEN'), ['NEW', 'OPEN']);
  assert.equal(requesterFilterStatuses('all'), null);

  const q = parseAdminInboxQuery({ queue: 'awaiting', category: 'BILLING', priority: 'NOPE', sort: 'x', page: '-3', q: '  sup-1 ', mine: '1' });
  assert.deepEqual(q, { queue: 'awaiting', category: 'BILLING', priority: null, q: 'sup-1', sort: 'activity', page: 1, mine: true });
  assert.equal(parseAdminInboxQuery({}).queue, 'active');
});

test('no store client can reach the support tables', () => {
  for (const model of ['SupportTicket', 'SupportMessage', 'SupportAttachment'] as const) {
    assert.equal(MODEL_SCOPES[model].kind, 'denied');
    assert.throws(() => scopeArgs(model, 'findMany', {}, 'store_a'), StoreScopeError);
    assert.throws(() => scopeArgs(model, 'create', { data: {} }, 'store_a'), StoreScopeError);
  }
});

test('every built-in store role can contact support; the platform role uses its own permissions', () => {
  for (const role of SYSTEM_ROLES) {
    const granted = resolveRolePermissions(role);
    if (role.slug === 'system-admin') assert.ok(!granted.includes('support.create'));
    else assert.ok(granted.includes('support.create'), `${role.slug} can contact support`);
  }
  assert.ok(ROUTE_PERMISSIONS.some((route) => route.prefix === '/support' && route.permission === 'support.create'));
});
