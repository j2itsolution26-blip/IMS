import 'server-only';

import { platformPrisma } from '@/lib/prisma';
import { platformNotificationKey } from '@/lib/notifications';
import { raisePlatformNotification } from '@/server/platform/platform-notification-service';

/**
 * Support notifications. Each is raised after the ticket or message has been
 * committed and never inside its transaction, so a notification that fails
 * cannot take the ticket with it. The inbox counts come from the tickets
 * themselves, so nothing is lost while a notification is missing, and
 * `syncSupportNotifications` (daily job) raises any that never arrived; each
 * has a unique key, so raising one twice stores it once.
 */

const CATEGORY_WORDS: Record<string, string> = {
  TECHNICAL_ISSUE: 'Technical issue',
  BUG_REPORT: 'Bug report',
  FEATURE_REQUEST: 'Feature request',
  BILLING: 'Billing',
  ACCOUNT_LOGIN: 'Account & login',
  INSTALLATION: 'Installation',
  GENERAL: 'General',
};

export interface TicketForNotice {
  id: string;
  number: string;
  subject: string;
  category: string;
  requesterName: string;
  storeId: string | null;
}

/** Every platform administrator: a new ticket is in the inbox. */
export async function notifyTicketCreated(ticket: TicketForNotice): Promise<void> {
  await raisePlatformNotification({
    kind: 'SUPPORT_TICKET_CREATED',
    title: `${ticket.number}: ${ticket.subject}`,
    body: `${CATEGORY_WORDS[ticket.category] ?? 'Support'} from ${ticket.requesterName}.`,
    href: `/system-admin/support/${ticket.number}`,
    storeId: ticket.storeId,
    dedupeKey: platformNotificationKey.supportTicketCreated(ticket.id),
  });
}

/** The administrators: the requester wrote again. Names the assignee when there is one. */
export async function notifyRequesterReplied(
  ticket: TicketForNotice & { assigneeName: string | null },
  messageId: string,
): Promise<void> {
  await raisePlatformNotification({
    kind: 'SUPPORT_USER_REPLIED',
    title: `${ticket.number}: new reply from ${ticket.requesterName}`,
    body: ticket.assigneeName ? `${ticket.subject} · assigned to ${ticket.assigneeName}` : ticket.subject,
    href: `/system-admin/support/${ticket.number}`,
    storeId: ticket.storeId,
    dedupeKey: platformNotificationKey.supportUserReplied(messageId),
  });
}

/**
 * The requester: support answered. Shown on the Support menu badge for every
 * requester; a store owner also gets it in their bell. The store bell is
 * shared by everyone with the financial permission, so it is only used when
 * the requester is the store's owner, and it says no more than the ticket
 * number.
 */
export async function notifyAdminReplied(
  ticket: { id: string; number: string; requesterId: string | null; storeId: string | null },
  messageId: string,
): Promise<void> {
  if (!ticket.requesterId || !ticket.storeId) return;
  const store = await platformPrisma.store.findUnique({ where: { id: ticket.storeId }, select: { ownerId: true } });
  if (store?.ownerId !== ticket.requesterId) return;
  await platformPrisma.notification.createMany({
    data: [
      {
        storeId: ticket.storeId,
        type: 'SUPPORT_REPLY',
        title: `Support replied to ${ticket.number}`,
        body: 'Open the ticket to read the reply.',
        href: `/support/${ticket.number}`,
        dedupeKey: `support-reply:${messageId}`,
      },
    ],
    skipDuplicates: true,
  });
}

/** Runs a notification without letting its failure reach the caller. */
export async function safely(label: string, send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error(`[support] notification failed (${label}); the daily job will retry`, error);
  }
}

/**
 * Raises any support notification that never arrived, for the last few days.
 * Idempotent: notifications already raised are skipped by their keys.
 */
export async function syncSupportNotifications(now: Date = new Date(), days = 3): Promise<{ checked: number }> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tickets = await platformPrisma.supportTicket.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, number: true, subject: true, category: true, requesterName: true, storeId: true },
    take: 500,
  });
  for (const ticket of tickets) await safely('sync created', () => notifyTicketCreated(ticket));

  const replies = await platformPrisma.supportMessage.findMany({
    where: { createdAt: { gte: since }, authorKind: { in: ['REQUESTER', 'ADMIN'] }, visibility: 'PUBLIC' },
    select: {
      id: true,
      authorKind: true,
      createdAt: true,
      ticket: {
        select: {
          id: true, number: true, subject: true, category: true, requesterName: true, storeId: true,
          requesterId: true, createdAt: true, assignedTo: { select: { name: true } },
        },
      },
    },
    take: 1000,
  });
  for (const reply of replies) {
    // The first requester message is the ticket itself (written with the
    // ticket's own timestamp), already notified above.
    if (reply.authorKind === 'REQUESTER') {
      if (reply.createdAt.getTime() === reply.ticket.createdAt.getTime()) continue;
      await safely('sync reply', () =>
        notifyRequesterReplied({ ...reply.ticket, assigneeName: reply.ticket.assignedTo?.name ?? null }, reply.id),
      );
    } else {
      await safely('sync admin reply', () => notifyAdminReplied(reply.ticket, reply.id));
    }
  }
  return { checked: tickets.length + replies.length };
}
