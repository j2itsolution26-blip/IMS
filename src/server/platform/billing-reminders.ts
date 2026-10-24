import 'server-only';

import { platformPrisma } from '@/lib/prisma';
import { reminderFor } from '@/lib/billing';
import { storeAccess } from '@/lib/store-access';
import { formatDate } from '@/lib/format';
import { platformNotificationKey } from '@/lib/notifications';
import { raisePlatformNotification } from '@/server/platform/platform-notification-service';

/**
 * Raises the billing reminders each store is owed (see `reminderFor`), and
 * tells administrators about trials ending soon or ended, invoices overdue,
 * and stores entering their grace period.
 *
 * Idempotent: every notification has a key unique to its event and window,
 * and the notification tables refuse a second row with the same key, so this
 * can run from the daily job, on page loads, or both, without duplicates. An
 * audit entry is written only for a notice actually raised now.
 *
 * Nothing here creates an invoice or a debt: reminders inform.
 */

interface StoreForReminders {
  id: string;
  name: string;
  plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE';
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  invoices: { id: string; number: string; dueAt: Date; payments: { id: string }[] }[];
}

const STORE_SELECT = {
  id: true,
  name: true,
  plan: true,
  status: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  invoices: {
    where: { status: 'OPEN' as const },
    take: 1,
    select: { id: true, number: true, dueAt: true, payments: { where: { status: 'PENDING' as const }, select: { id: true } } },
  },
};

type Tx = Parameters<Parameters<typeof platformPrisma.$transaction>[0]>[0];

/** One owner notice plus its audit entry, only when it is new. */
async function noticeOwner(tx: Tx, store: StoreForReminders, key: string, title: string, body: string): Promise<boolean> {
  const raised = await tx.notification.createMany({
    data: [{ storeId: store.id, type: 'BILLING_REMINDER', title, body, href: '/settings/subscription', dedupeKey: `billing:${key}` }],
    skipDuplicates: true,
  });
  if (raised.count === 0) return false;
  await tx.auditLog.create({
    data: {
      storeId: store.id,
      userId: null,
      action: 'SUBSCRIPTION',
      entity: 'Store',
      entityId: store.id,
      summary: `Billing reminder sent: ${title}`,
      changes: { reminder: key },
    },
  });
  return true;
}

async function remindStore(store: StoreForReminders, now: Date): Promise<boolean> {
  if (store.status === 'SUSPENDED') return false;
  const invoice = store.invoices[0] ?? null;
  const reminder = reminderFor({
    subscription: store,
    openInvoice: invoice ? { id: invoice.id, number: invoice.number, dueAt: invoice.dueAt } : null,
    hasPendingPayment: (invoice?.payments.length ?? 0) > 0,
    now,
  });
  const access = storeAccess(store, now);

  return platformPrisma.$transaction(async (tx) => {
    let raised = false;

    if (reminder && (await noticeOwner(tx, store, reminder.key, reminder.title, reminder.body))) {
      raised = true;
      const href = `/system-admin/stores/${store.id}`;
      if (reminder.key.includes(':overdue-')) {
        await raisePlatformNotification(
          { kind: 'INVOICE_OVERDUE', title: `${store.name}: ${reminder.title.toLowerCase()}`, body: reminder.body, href, storeId: store.id, dedupeKey: `billing:${store.id}:${reminder.key}` },
          { db: tx },
        );
      } else if (reminder.key.endsWith(':ended')) {
        await raisePlatformNotification(
          {
            kind: 'TRIAL_ENDED',
            title: `${store.name}: trial ended`,
            // A trial ending is not a debt: say what is true.
            body: 'No paid plan has been chosen. Nothing is owed unless the owner chooses one.',
            href,
            storeId: store.id,
            dedupeKey: `billing:${store.id}:${reminder.key}`,
          },
          { db: tx },
        );
      } else if (reminder.key.endsWith(':3d') && store.trialEndsAt) {
        await raisePlatformNotification(
          {
            kind: 'TRIAL_ENDING',
            title: `${store.name}: trial ends ${formatDate(store.trialEndsAt)}`,
            body: invoice ? 'The owner has already chosen a plan.' : 'No paid plan chosen yet.',
            href,
            storeId: store.id,
            dedupeKey: platformNotificationKey.trialEnding(store.id, store.trialEndsAt),
          },
          { db: tx },
        );
      }
    }

    // First time this store is seen in its grace period, for this ending.
    if (access.state === 'GRACE' && access.endsAt && access.graceEndsAt) {
      const wasTrial = store.status === 'TRIAL';
      const createdAdmin = await raisePlatformNotification(
        {
          kind: 'GRACE_STARTED',
          title: `${store.name}: grace period started`,
          body: `${wasTrial ? 'Trial' : 'Paid period'} ended ${formatDate(access.endsAt)}; read-only from ${formatDate(access.graceEndsAt)} unless renewed.`,
          href: `/system-admin/stores/${store.id}`,
          storeId: store.id,
          dedupeKey: platformNotificationKey.graceStarted(store.id, access.endsAt),
        },
        { db: tx },
      );
      // A paid period ending has no trial reminder of its own, so the owner
      // hears it here. Informational: it states access, not money owed.
      if (!wasTrial && !invoice) {
        const ownerNoticed = await noticeOwner(
          tx,
          store,
          `period:${access.endsAt.toISOString()}:grace`,
          'Your plan has ended',
          `Everything keeps working until ${formatDate(access.graceEndsAt)}, then your store becomes read-only. Choose a plan to renew.`,
        );
        raised = raised || ownerNoticed;
      }
      raised = raised || createdAdmin;
    }

    return raised;
  });
}

/** Every store. For the daily job and the administrator's billing page. */
export async function runBillingReminders(now: Date = new Date()): Promise<{ stores: number; raised: number }> {
  const stores = await platformPrisma.store.findMany({ where: { status: { not: 'SUSPENDED' } }, select: STORE_SELECT });
  let raised = 0;
  for (const store of stores) {
    try {
      if (await remindStore(store, now)) raised += 1;
    } catch (error) {
      // One store's failure must not stop the others; the next run retries it.
      console.error('[billing] reminder failed for store', store.id, error);
    }
  }
  return { stores: stores.length, raised };
}

/** One store. For the owner's billing page, so a reminder appears even if the job did not run. */
export async function runBillingRemindersForStore(storeId: string, now: Date = new Date()): Promise<void> {
  const store = await platformPrisma.store.findUnique({ where: { id: storeId }, select: STORE_SELECT });
  if (store) await remindStore(store, now);
}
