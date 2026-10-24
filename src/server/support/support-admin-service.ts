import 'server-only';

import { Prisma } from '@prisma/client';
import type { SupportPriority, SupportStatus } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  PRIORITY_INFO,
  STATUS_INFO,
  SUPPORT_PAGE_SIZE,
  adminReplyEffect,
  awaitingAdmin,
  canAdminTransition,
  lifecycleStamps,
  type AdminInboxQuery,
} from '@/lib/support';
import { removeFiles, storeFiles, type CheckedFile } from '@/server/support/support-storage';
import { notifyAdminReplied, safely } from '@/server/support/support-notify';
import { recordSupportAudit } from '@/server/support/support-audit';
import type { ThreadMessage } from '@/server/support/support-service';

/**
 * The platform administrators' Support Inbox.
 *
 * Every function here is called only behind `platform.view` (reads) or
 * `platform.manage` (changes), checked by the caller from the session. The
 * acting administrator is passed in from that session, never from the
 * request. Status changes are validated against the stored status and
 * written only if it is still the status that was checked, so two
 * administrators acting at once cannot skip a step.
 *
 * Billing details are deliberately not read here: the inbox shows who wrote
 * and from which store, nothing about their subscription.
 */

export interface Admin {
  id: string;
  name: string;
}

const TX = { timeout: 15_000, maxWait: 10_000 } as const;
const ACTIVE: SupportStatus[] = ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'];

/** Tickets waiting on support: active, and never answered or answered before the requester's last message. */
function awaitingWhere(): Prisma.SupportTicketWhereInput {
  return {
    status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] },
    OR: [
      { lastAdminReplyAt: null },
      { lastRequesterReplyAt: { gt: platformPrisma.supportTicket.fields.lastAdminReplyAt } },
    ],
  };
}

export interface InboxSummary {
  open: number;
  new: number;
  awaiting: number;
  waiting: number;
  resolved: number;
}

/** The summary cards, counted from the tickets themselves. */
export async function inboxSummary(): Promise<InboxSummary> {
  const [open, fresh, awaiting, waiting, resolved] = await Promise.all([
    platformPrisma.supportTicket.count({ where: { status: { in: ACTIVE } } }),
    platformPrisma.supportTicket.count({ where: { status: 'NEW' } }),
    platformPrisma.supportTicket.count({ where: awaitingWhere() }),
    platformPrisma.supportTicket.count({ where: { status: 'WAITING_FOR_USER' } }),
    platformPrisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
  ]);
  return { open, new: fresh, awaiting, waiting, resolved };
}

/** The sidebar badge: tickets waiting on support. */
export async function countAwaitingAdmin(): Promise<number> {
  return platformPrisma.supportTicket.count({ where: awaitingWhere() });
}

export interface InboxRow {
  number: string;
  subject: string;
  requesterName: string;
  requesterKind: 'account' | 'public' | 'deleted';
  storeName: string | null;
  category: string;
  priority: SupportPriority;
  status: SupportStatus;
  assigneeName: string | null;
  createdAt: string;
  lastActivityAt: string;
  awaiting: boolean;
}

function queueWhere(query: AdminInboxQuery): Prisma.SupportTicketWhereInput {
  switch (query.queue) {
    case 'active':
      return { status: { in: ACTIVE } };
    case 'new':
      return { status: 'NEW' };
    case 'awaiting':
      return awaitingWhere();
    case 'waiting':
      return { status: 'WAITING_FOR_USER' };
    case 'resolved':
      return { status: 'RESOLVED' };
    case 'closed':
      return { status: 'CLOSED' };
    default:
      return {};
  }
}

function orderBy(query: AdminInboxQuery): Prisma.SupportTicketOrderByWithRelationInput[] {
  switch (query.sort) {
    case 'created':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    // Enum order in the database is LOW, NORMAL, HIGH, URGENT.
    case 'priority':
      return [{ priority: 'desc' }, { lastActivityAt: 'desc' }, { id: 'desc' }];
    default:
      return [{ lastActivityAt: 'desc' }, { id: 'desc' }];
  }
}

export async function listInbox(query: AdminInboxQuery, adminId: string): Promise<{ items: InboxRow[]; total: number }> {
  const search = query.q;
  const where: Prisma.SupportTicketWhereInput = {
    AND: [
      queueWhere(query),
      query.category ? { category: query.category } : {},
      query.priority ? { priority: query.priority } : {},
      query.mine ? { assignedToId: adminId } : {},
      search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { requesterName: { contains: search, mode: 'insensitive' } },
              { replyEmail: { contains: search, mode: 'insensitive' } },
              { store: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    platformPrisma.supportTicket.findMany({
      where,
      orderBy: orderBy(query),
      take: SUPPORT_PAGE_SIZE,
      skip: (query.page - 1) * SUPPORT_PAGE_SIZE,
      select: {
        number: true, subject: true, requesterName: true, requesterId: true, source: true, category: true,
        priority: true, status: true, createdAt: true, lastActivityAt: true, lastAdminReplyAt: true,
        lastRequesterReplyAt: true,
        store: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    platformPrisma.supportTicket.count({ where }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      number: row.number,
      subject: row.subject,
      requesterName: row.requesterName,
      requesterKind: row.source === 'PUBLIC' ? 'public' : row.requesterId ? 'account' : 'deleted',
      storeName: row.store?.name ?? null,
      category: row.category,
      priority: row.priority,
      status: row.status,
      assigneeName: row.assignedTo?.name ?? null,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      awaiting: awaitingAdmin(row),
    })),
  };
}

export interface AdminTicketDetail {
  id: string;
  number: string;
  subject: string;
  category: string;
  status: SupportStatus;
  priority: SupportPriority;
  source: 'PUBLIC' | 'APP';
  requester: {
    name: string;
    /** Only for public tickets: where to answer. */
    replyEmail: string | null;
    username: string | null;
    email: string | null;
    roleName: string | null;
    active: boolean | null;
  };
  store: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  messages: ThreadMessage[];
  history: { id: string; summary: string; actorName: string | null; createdAt: string }[];
}

export async function getTicketForAdmin(number: string): Promise<AdminTicketDetail | null> {
  const ticket = await platformPrisma.supportTicket.findUnique({
    where: { number },
    select: {
      id: true, number: true, subject: true, category: true, status: true, priority: true, source: true,
      requesterName: true, replyEmail: true, createdAt: true, lastActivityAt: true, resolvedAt: true, closedAt: true,
      requester: { select: { username: true, email: true, isActive: true, role: { select: { name: true } } } },
      store: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, authorKind: true, visibility: true, body: true, createdAt: true,
          author: { select: { name: true } },
          attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
        },
      },
    },
  });
  if (!ticket) return null;

  const history = await platformPrisma.auditLog.findMany({
    where: { entity: 'SupportTicket', entityId: ticket.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, summary: true, createdAt: true, user: { select: { name: true } } },
  });

  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    requester: {
      name: ticket.requesterName,
      replyEmail: ticket.replyEmail,
      username: ticket.requester?.username ?? null,
      email: ticket.requester?.email ?? null,
      roleName: ticket.requester?.role.name ?? null,
      active: ticket.requester ? ticket.requester.isActive : null,
    },
    store: ticket.store,
    assignee: ticket.assignedTo,
    createdAt: ticket.createdAt.toISOString(),
    lastActivityAt: ticket.lastActivityAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    messages: ticket.messages.map((message) => ({
      id: message.id,
      authorKind: message.authorKind,
      authorName:
        message.authorKind === 'SYSTEM' ? 'System'
        : message.author?.name ?? (message.authorKind === 'REQUESTER' ? ticket.requesterName : 'Former administrator'),
      visibility: message.visibility,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((file) => ({
        id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
      })),
    })),
    history: history.map((entry) => ({
      id: entry.id,
      summary: entry.summary,
      actorName: entry.user?.name ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

async function loadForChange(number: string) {
  const ticket = await platformPrisma.supportTicket.findUnique({
    where: { number },
    select: {
      id: true, number: true, status: true, priority: true, requesterId: true, storeId: true,
      resolvedAt: true, closedAt: true, assignedToId: true,
    },
  });
  if (!ticket) throw new NotFoundError('Ticket');
  return ticket;
}

const STALE = 'This ticket just changed. Reload the page and try again.';

/** A reply the requester reads. The status follows from `adminReplyEffect`. */
export async function replyAsAdmin(
  admin: Admin,
  number: string,
  body: string,
  options: { waitForUser: boolean; files?: CheckedFile[] },
): Promise<{ status: SupportStatus }> {
  const ticket = await loadForChange(number);
  const effect = adminReplyEffect(ticket.status, options.waitForUser);
  if (!effect.allowed) throw new ConflictError('This ticket is closed. Reopen it before replying.');

  const stored = await storeFiles(ticket.id, options.files ?? []);
  const now = new Date();
  let messageId: string;
  try {
    messageId = await platformPrisma.$transaction(async (tx) => {
      const moved = await tx.supportTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: effect.next,
          lastActivityAt: now,
          lastAdminReplyAt: now,
          ...(effect.next !== ticket.status ? lifecycleStamps(effect.next, ticket, now) : {}),
        },
      });
      if (moved.count !== 1) throw new ConflictError(STALE);
      const message = await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorId: admin.id, authorKind: 'ADMIN', visibility: 'PUBLIC', body, createdAt: now },
        select: { id: true },
      });
      if (stored.length > 0) {
        await tx.supportAttachment.createMany({
          data: stored.map((file) => ({ ...file, ticketId: ticket.id, messageId: message.id, uploadedById: admin.id })),
        });
      }
      if (effect.next !== ticket.status) {
        await tx.supportMessage.create({
          data: {
            ticketId: ticket.id, authorId: admin.id, authorKind: 'SYSTEM', visibility: 'PUBLIC',
            body: `Status changed to ${STATUS_INFO[effect.next].label}.`, createdAt: new Date(now.getTime() + 1),
          },
        });
      }
      return message.id;
    }, TX);
  } catch (error) {
    await removeFiles(stored.map((file) => file.storagePath));
    throw error;
  }

  await safely('audit', () =>
    recordSupportAudit({ id: admin.id, store: null }, {
      action: 'UPDATE',
      entityId: ticket.id,
      summary: `Replied to ${ticket.number}${effect.next !== ticket.status ? ` (${STATUS_INFO[ticket.status].label} → ${STATUS_INFO[effect.next].label})` : ''}`,
    }),
  );
  await safely('admin replied', () => notifyAdminReplied(ticket, messageId));
  return { status: effect.next };
}

/** A note only administrators read. Never changes the status, never notifies the requester. */
export async function addInternalNote(admin: Admin, number: string, body: string): Promise<void> {
  const ticket = await loadForChange(number);
  const now = new Date();
  await platformPrisma.$transaction(async (tx) => {
    await tx.supportMessage.create({
      data: { ticketId: ticket.id, authorId: admin.id, authorKind: 'ADMIN', visibility: 'INTERNAL', body, createdAt: now },
    });
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { lastActivityAt: now } });
  }, TX);
}

/** Moves the ticket along the workflow; refused unless the move is allowed from the stored status. */
export async function changeStatus(
  admin: Admin,
  number: string,
  to: SupportStatus,
  expectedFrom: SupportStatus,
): Promise<void> {
  const ticket = await loadForChange(number);
  if (ticket.status !== expectedFrom) throw new ConflictError(STALE);
  if (!canAdminTransition(ticket.status, to)) {
    throw new ValidationError(`A ${STATUS_INFO[ticket.status].label.toLowerCase()} ticket cannot be moved to ${STATUS_INFO[to].label.toLowerCase()}.`);
  }
  const now = new Date();
  await platformPrisma.$transaction(async (tx) => {
    const moved = await tx.supportTicket.updateMany({
      where: { id: ticket.id, status: ticket.status },
      data: { status: to, lastActivityAt: now, ...lifecycleStamps(to, ticket, now) },
    });
    if (moved.count !== 1) throw new ConflictError(STALE);
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id, authorId: admin.id, authorKind: 'SYSTEM', visibility: 'PUBLIC',
        body: ticket.status === 'CLOSED' ? 'Ticket reopened by support.' : `Status changed to ${STATUS_INFO[to].label}.`,
        createdAt: now,
      },
    });
  }, TX);
  await recordSupportAudit({ id: admin.id, store: null }, {
    action: 'UPDATE',
    entityId: ticket.id,
    summary: `${ticket.number}: ${STATUS_INFO[ticket.status].label} → ${STATUS_INFO[to].label}`,
    changes: { status: { from: ticket.status, to } },
  });
}

export async function setPriority(admin: Admin, number: string, priority: SupportPriority): Promise<void> {
  const ticket = await loadForChange(number);
  if (ticket.priority === priority) return;
  const now = new Date();
  await platformPrisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { priority } });
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id, authorId: admin.id, authorKind: 'SYSTEM', visibility: 'INTERNAL',
        body: `Priority set to ${PRIORITY_INFO[priority].label}.`, createdAt: now,
      },
    });
  }, TX);
  await recordSupportAudit({ id: admin.id, store: null }, {
    action: 'UPDATE',
    entityId: ticket.id,
    summary: `${ticket.number}: priority ${PRIORITY_INFO[ticket.priority].label} → ${PRIORITY_INFO[priority].label}`,
    changes: { priority: { from: ticket.priority, to: priority } },
  });
}

/** Administrators a ticket can be assigned to: active platform accounts that can manage. */
export async function listAssignableAdmins(): Promise<{ id: string; name: string }[]> {
  return platformPrisma.user.findMany({
    where: {
      storeId: null,
      isActive: true,
      role: { permissions: { some: { permission: { key: 'platform.manage' } } } },
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: 100,
  });
}

export async function assignTicket(admin: Admin, number: string, assigneeId: string | null): Promise<void> {
  const ticket = await loadForChange(number);
  if (ticket.assignedToId === assigneeId) return;
  let assigneeName = 'nobody';
  if (assigneeId) {
    const assignee = (await listAssignableAdmins()).find((candidate) => candidate.id === assigneeId);
    if (!assignee) throw new ValidationError('Choose an active administrator.');
    assigneeName = assignee.name;
  }
  const now = new Date();
  await platformPrisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { assignedToId: assigneeId } });
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id, authorId: admin.id, authorKind: 'SYSTEM', visibility: 'INTERNAL',
        body: assigneeId ? `Assigned to ${assigneeName}.` : 'Unassigned.', createdAt: now,
      },
    });
  }, TX);
  await recordSupportAudit({ id: admin.id, store: null }, {
    action: 'UPDATE',
    entityId: ticket.id,
    summary: `${ticket.number}: assigned to ${assigneeName}`,
    changes: { assignedToId: { from: ticket.assignedToId, to: assigneeId } },
  });
}

/** Any attachment, for a platform administrator. */
export async function findAttachmentForAdmin(attachmentId: string) {
  return platformPrisma.supportAttachment.findUnique({
    where: { id: attachmentId },
    select: { storagePath: true, originalName: true },
  });
}
