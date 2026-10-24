import 'server-only';

import { platformPrisma } from '@/lib/prisma';
import { reminderFor } from '@/lib/billing';

/**
 * Raises the billing reminders each store is owed (see `reminderFor`).
 *
 * Idempotent: every reminder has a key unique to its event and window, and
 * the notification tables refuse a second row with the same key, so this can
 * run from the daily job, on page loads, or both, without duplicates. An
 * audit entry is written only for a reminder actually raised now.
 *
 * Reminders inform; they never create an invoice or a debt.
 */

interface StoreForReminders {
  id: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  trialEndsAt: Date | null;
  invoices: { id: string; number: string; dueAt: Date; payments: { id: string }[] }[];
}

const STORE_SELECT = {
  id: true,
  name: true,
  status: true,
  trialEndsAt: true,
  invoices: {
    where: { status: 'OPEN' as const },
    take: 1,
    select: { id: true, number: true, dueAt: true, payments: { where: { status: 'PENDING' as const }, select: { id: true } } },
  },
};

async function remindStore(store: StoreForReminders, now: Date): Promise<boolean> {
  if (store.status === 'SUSPENDED') return false;
  const invoice = store.invoices[0] ?? null;
  const reminder = reminderFor({
    subscription: store,
    openInvoice: invoice ? { id: invoice.id, number: invoice.number, dueAt: invoice.dueAt } : null,
    hasPendingPayment: (invoice?.payments.length ?? 0) > 0,
    now,
  });
  if (!reminder) return false;

  return platformPrisma.$transaction(async (tx) => {
    const raised = await tx.notification.createMany({
      data: [
        {
          storeId: store.id,
          type: 'BILLING_REMINDER',
          title: reminder.title,
          body: reminder.body,
          href: '/settings/subscription',
          dedupeKey: `billing:${reminder.key}`,
        },
      ],
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
        summary: `Billing reminder sent: ${reminder.title}`,
        changes: { reminder: reminder.key },
      },
    });

    // The administrator hears about overdue invoices and ended trials too.
    if (reminder.key.includes(':overdue-') || reminder.key.endsWith(':ended')) {
      await tx.platformNotification.createMany({
        data: [
          {
            kind: reminder.key.includes(':overdue-') ? 'INVOICE_OVERDUE' : 'TRIAL_ENDED',
            title: `${store.name}: ${reminder.title.toLowerCase()}`,
            body: reminder.body,
            href: `/system-admin/stores/${store.id}`,
            storeId: store.id,
            dedupeKey: `billing:${store.id}:${reminder.key}`,
          },
        ],
        skipDuplicates: true,
      });
    }
    return true;
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
