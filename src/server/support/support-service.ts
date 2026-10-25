import 'server-only';

import { Prisma } from '@prisma/client';
import type { SupportCategory, SupportStatus } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import {
  SUPPORT_PAGE_SIZE,
  defaultPriority,
  hasUnreadReply,
  requesterFilterStatuses,
  requesterReplyEffect,
  type RequesterFilter,
} from '@/lib/support';
import { APP_LIMITS, PUBLIC_LIMITS } from '@/lib/support-abuse-rules';
import { removeFiles, storeFiles, type CheckedFile, type StoredFile } from '@/server/support/support-storage';
import { notifyRequesterReplied, notifyTicketCreated, safely } from '@/server/support/support-notify';
import { recordSupportAudit } from '@/server/support/support-audit';

/**
 * The requester's side of support: open a ticket, list one's own, read the
 * conversation, reply.
 *
 * Uses the platform client on purpose (see MODEL_SCOPES): support must work
 * for a suspended or read-only store, and for the public Help page. Every
 * query here is confined to the requester the caller passes, which always
 * comes from the server session (`authenticate`/`authorize`), never from the
 * request. A ticket that is not the requester's is reported as not found, so
 * nobody can learn whether a number exists. Internal notes are filtered out at
 * the query, never after it.
 */

export interface Requester {
  id: string;
  name: string;
  store: { id: string } | null;
}

export interface NewTicket {
  category: SupportCategory;
  subject: string;
  description: string;
  submissionKey: string;
}

export interface CreatedTicket {
  number: string;
  /** False when this submission had already been stored (a double click or a retry). */
  created: boolean;
}

const TX = { timeout: 15_000, maxWait: 10_000 } as const;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}

/** Writes the ticket, its first message and any screenshots; uploads are removed again if the write fails. */
async function writeTicket(
  data: Omit<Prisma.SupportTicketUncheckedCreateInput, 'messages' | 'attachments'>,
  description: string,
  authorId: string | null,
  files: CheckedFile[],
): Promise<{ id: string; number: string }> {
  // A provisional id lets the screenshots go into the ticket's folder before the row exists.
  const id = data.id ?? `t${crypto.randomUUID().replace(/-/g, '')}`;
  const stored: StoredFile[] = await storeFiles(id, files);
  const now = new Date();
  try {
    return await platformPrisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: { ...data, id, createdAt: now, lastActivityAt: now, lastRequesterReplyAt: now },
        select: { id: true, number: true },
      });
      const message = await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorId, authorKind: 'REQUESTER', visibility: 'PUBLIC', body: description, createdAt: now },
        select: { id: true },
      });
      if (stored.length > 0) {
        await tx.supportAttachment.createMany({
          data: stored.map((file) => ({ ...file, ticketId: ticket.id, messageId: message.id, uploadedById: authorId })),
        });
      }
      return ticket;
    }, TX);
  } catch (error) {
    await removeFiles(stored.map((file) => file.storagePath));
    throw error;
  }
}

async function afterCreate(ticket: { id: string; number: string }, input: NewTicket, requesterName: string, storeId: string | null) {
  await safely('ticket created', () =>
    notifyTicketCreated({ ...ticket, subject: input.subject, category: input.category, requesterName, storeId }),
  );
}

/** A signed-in account opens a ticket. The requester and store come from the session. */
export async function createTicket(
  requester: Requester,
  input: NewTicket,
  options: { ipHash: string | null; files?: CheckedFile[] },
): Promise<CreatedTicket> {
  const existing = await platformPrisma.supportTicket.findUnique({
    where: { submissionKey: input.submissionKey },
    select: { number: true, requesterId: true },
  });
  if (existing) {
    // The same form sent twice: answer with the ticket already stored. A key
    // that belongs to someone else is refused without saying so.
    if (existing.requesterId === requester.id) return { number: existing.number, created: false };
    throw new ValidationError('Please reload the page and try again.');
  }

  const recent = await platformPrisma.supportTicket.count({
    where: { requesterId: requester.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= APP_LIMITS.ticketsPerHour) throw new RateLimitError(15 * 60);

  let ticket: { id: string; number: string };
  try {
    ticket = await writeTicket(
      {
        source: 'APP',
        requesterId: requester.id,
        storeId: requester.store?.id ?? null,
        requesterName: requester.name,
        category: input.category,
        subject: input.subject,
        priority: defaultPriority(input.category),
        submissionKey: input.submissionKey,
        ipHash: options.ipHash,
      },
      input.description,
      requester.id,
      options.files ?? [],
    );
  } catch (error) {
    // Two copies of the same submission raced; the other one won.
    if (isUniqueViolation(error, 'submissionKey')) {
      const winner = await platformPrisma.supportTicket.findUnique({
        where: { submissionKey: input.submissionKey },
        select: { number: true, requesterId: true },
      });
      if (winner?.requesterId === requester.id) return { number: winner.number, created: false };
    }
    throw error;
  }

  await safely('audit', () =>
    recordSupportAudit(requester, {
      action: 'CREATE',
      entityId: ticket.id,
      summary: `Opened support ticket ${ticket.number}`,
      changes: { category: input.category },
    }),
  );
  await afterCreate(ticket, input, requester.name, requester.store?.id ?? null);
  return { number: ticket.number, created: true };
}

/**
 * Someone who cannot sign in writes from the Help page. Never linked to an
 * account: an email address proves nothing about who is typing it. The reply
 * address is kept only so support can answer.
 */
export async function createPublicTicket(
  input: NewTicket & { name: string; email: string },
  options: { ipHash: string | null; files?: CheckedFile[] },
): Promise<CreatedTicket> {
  const existing = await platformPrisma.supportTicket.findUnique({
    where: { submissionKey: input.submissionKey },
    select: { number: true, source: true, replyEmail: true },
  });
  if (existing) {
    if (existing.source === 'PUBLIC' && existing.replyEmail === input.email) return { number: existing.number, created: false };
    throw new ValidationError('Please reload the page and try again.');
  }

  const hour = new Date(Date.now() - 60 * 60 * 1000);
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [byIp, byEmail] = await Promise.all([
    options.ipHash
      ? platformPrisma.supportTicket.count({ where: { source: 'PUBLIC', ipHash: options.ipHash, createdAt: { gte: hour } } })
      : 0,
    platformPrisma.supportTicket.count({ where: { source: 'PUBLIC', replyEmail: input.email, createdAt: { gte: day } } }),
  ]);
  if (byIp >= PUBLIC_LIMITS.perIpPerHour || byEmail >= PUBLIC_LIMITS.perEmailPerDay) throw new RateLimitError(60 * 60);

  let ticket: { id: string; number: string };
  try {
    ticket = await writeTicket(
      {
        source: 'PUBLIC',
        requesterId: null,
        storeId: null,
        requesterName: input.name,
        replyEmail: input.email,
        category: input.category,
        subject: input.subject,
        priority: defaultPriority(input.category),
        submissionKey: input.submissionKey,
        ipHash: options.ipHash,
      },
      input.description,
      null,
      options.files ?? [],
    );
  } catch (error) {
    if (isUniqueViolation(error, 'submissionKey')) {
      const winner = await platformPrisma.supportTicket.findUnique({
        where: { submissionKey: input.submissionKey },
        select: { number: true, source: true, replyEmail: true },
      });
      if (winner?.source === 'PUBLIC' && winner.replyEmail === input.email) return { number: winner.number, created: false };
    }
    throw error;
  }

  await afterCreate(ticket, input, input.name, null);
  return { number: ticket.number, created: true };
}

export interface MyTicketRow {
  number: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: string;
  lastActivityAt: string;
  unreadReply: boolean;
}

/** The requester's own tickets, most recently active first. */
export async function listMyTickets(
  requesterId: string,
  filter: RequesterFilter,
  page: number,
): Promise<{ items: MyTicketRow[]; total: number; counts: Record<SupportStatus, number> }> {
  const statuses = requesterFilterStatuses(filter);
  const where: Prisma.SupportTicketWhereInput = { requesterId, ...(statuses ? { status: { in: statuses } } : {}) };
  const [rows, total, grouped] = await Promise.all([
    platformPrisma.supportTicket.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: SUPPORT_PAGE_SIZE,
      skip: (page - 1) * SUPPORT_PAGE_SIZE,
      select: {
        number: true, subject: true, category: true, status: true, createdAt: true,
        lastActivityAt: true, lastAdminReplyAt: true, requesterReadAt: true,
      },
    }),
    platformPrisma.supportTicket.count({ where }),
    platformPrisma.supportTicket.groupBy({ by: ['status'], where: { requesterId }, _count: { _all: true } }),
  ]);
  const counts = { NEW: 0, OPEN: 0, IN_PROGRESS: 0, WAITING_FOR_USER: 0, RESOLVED: 0, CLOSED: 0 } as Record<SupportStatus, number>;
  for (const group of grouped) counts[group.status] = group._count._all;
  return {
    total,
    counts,
    items: rows.map((row) => ({
      number: row.number,
      subject: row.subject,
      category: row.category,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      unreadReply: hasUnreadReply(row),
    })),
  };
}

/** The requester's own tickets in one category that support has not finished with. */
export async function countMyActiveTickets(requesterId: string, category: SupportCategory): Promise<number> {
  return platformPrisma.supportTicket.count({
    where: { requesterId, category, status: { in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] } },
  });
}

/** Tickets with a reply the requester has not opened: the Support menu badge. */
export async function countMyUnreadReplies(requesterId: string): Promise<number> {
  const rows = await platformPrisma.supportTicket.findMany({
    where: { requesterId, lastAdminReplyAt: { not: null }, status: { not: 'CLOSED' } },
    select: { lastAdminReplyAt: true, requesterReadAt: true },
    take: 200,
  });
  return rows.filter(hasUnreadReply).length;
}

export interface AttachmentView {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ThreadMessage {
  id: string;
  authorKind: 'REQUESTER' | 'ADMIN' | 'SYSTEM';
  /** Requesters see "Support" for every administrator; administrators see names. */
  authorName: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  body: string;
  createdAt: string;
  attachments: AttachmentView[];
}

export interface MyTicketDetail {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  messages: ThreadMessage[];
}

/** One of the requester's tickets with its public conversation, or null when it is not theirs. */
export async function getMyTicket(requesterId: string, number: string): Promise<MyTicketDetail | null> {
  const ticket = await platformPrisma.supportTicket.findFirst({
    where: { number, requesterId },
    select: {
      id: true, number: true, subject: true, category: true, status: true, createdAt: true,
      lastActivityAt: true, resolvedAt: true, closedAt: true, requesterName: true,
      messages: {
        // Internal notes never leave the database for a requester.
        where: { visibility: 'PUBLIC' },
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
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    createdAt: ticket.createdAt.toISOString(),
    lastActivityAt: ticket.lastActivityAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    messages: ticket.messages.map((message) => ({
      id: message.id,
      authorKind: message.authorKind,
      authorName:
        message.authorKind === 'REQUESTER' ? (message.author?.name ?? ticket.requesterName)
        : message.authorKind === 'ADMIN' ? 'TindahanProMax Support'
        : 'Update',
      visibility: message.visibility,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((file) => ({
        id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
      })),
    })),
  };
}

/** The requester opened the conversation: replies so far are read. */
export async function markMyTicketRead(requesterId: string, ticketId: string): Promise<void> {
  await platformPrisma.supportTicket.updateMany({
    where: { id: ticketId, requesterId },
    data: { requesterReadAt: new Date() },
  });
}

/**
 * The requester replies. A ticket waiting on them or marked resolved goes
 * back to support; a closed one refuses. The status written is decided here
 * from the stored status, and only if that status is still what was read.
 */
export async function replyToMyTicket(
  requester: Requester,
  number: string,
  body: string,
  files: CheckedFile[] = [],
): Promise<{ status: SupportStatus }> {
  const ticket = await platformPrisma.supportTicket.findFirst({
    where: { number, requesterId: requester.id },
    select: {
      id: true, number: true, subject: true, category: true, status: true, requesterName: true, storeId: true,
      assignedTo: { select: { name: true } },
    },
  });
  if (!ticket) throw new NotFoundError('Ticket');

  const effect = requesterReplyEffect(ticket.status);
  if (!effect.allowed) {
    throw new ConflictError('This ticket is closed. Open a new ticket if you still need help.');
  }

  const stored = await storeFiles(ticket.id, files);
  const now = new Date();
  let messageId: string;
  try {
    messageId = await platformPrisma.$transaction(async (tx) => {
      const moved = await tx.supportTicket.updateMany({
        where: { id: ticket.id, requesterId: requester.id, status: ticket.status },
        data: {
          status: effect.next,
          lastActivityAt: now,
          lastRequesterReplyAt: now,
          requesterReadAt: now,
          ...(effect.next !== ticket.status ? { resolvedAt: null, closedAt: null } : {}),
        },
      });
      if (moved.count !== 1) throw new ConflictError('This ticket just changed. Reload the page and try again.');
      const message = await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorId: requester.id, authorKind: 'REQUESTER', visibility: 'PUBLIC', body, createdAt: now },
        select: { id: true },
      });
      if (stored.length > 0) {
        await tx.supportAttachment.createMany({
          data: stored.map((file) => ({ ...file, ticketId: ticket.id, messageId: message.id, uploadedById: requester.id })),
        });
      }
      if (effect.next !== ticket.status) {
        await tx.supportMessage.create({
          data: {
            ticketId: ticket.id, authorKind: 'SYSTEM', visibility: 'PUBLIC',
            body: 'Reopened by your reply. Support will take another look.', createdAt: new Date(now.getTime() + 1),
          },
        });
      }
      return message.id;
    }, TX);
  } catch (error) {
    await removeFiles(stored.map((file) => file.storagePath));
    throw error;
  }

  await safely('requester replied', () =>
    notifyRequesterReplied({ ...ticket, assigneeName: ticket.assignedTo?.name ?? null }, messageId),
  );
  return { status: effect.next };
}

/** An attachment on a public message of the requester's own ticket, or null. */
export async function findMyAttachment(requesterId: string, attachmentId: string) {
  return platformPrisma.supportAttachment.findFirst({
    where: { id: attachmentId, ticket: { requesterId }, message: { visibility: 'PUBLIC' } },
    select: { storagePath: true, originalName: true },
  });
}
