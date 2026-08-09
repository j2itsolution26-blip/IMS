'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/action';

/**
 * Notification actions.
 *
 * A user may only touch notifications addressed to them or broadcast to
 * everyone, so the `userId` filter is repeated on every write — never trust the
 * id that came from the client.
 */

const scopeFor = (userId: string) => ({ OR: [{ userId }, { userId: null }] });

export async function markNotificationRead(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('notifications.view');

    await prisma.notification.updateMany({
      where: { id, readAt: null, ...scopeFor(user.id) },
      data: { readAt: new Date() },
    });

    revalidatePath('/notifications');
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await authorize('notifications.view');

    const result = await prisma.notification.updateMany({
      where: { readAt: null, dismissedAt: null, ...scopeFor(user.id) },
      data: { readAt: new Date() },
    });

    revalidatePath('/notifications');
    return result.count;
  });
}

export async function dismissNotification(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('notifications.view');
    const now = new Date();

    await prisma.notification.updateMany({
      where: { id, dismissedAt: null, ...scopeFor(user.id) },
      // Dismissing also marks it read — an unread counter that survives a
      // dismiss is a bug users notice immediately.
      data: { dismissedAt: now, readAt: now },
    });

    revalidatePath('/notifications');
  });
}

export async function dismissAllNotifications(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await authorize('notifications.manage');
    const now = new Date();

    const result = await prisma.notification.updateMany({
      where: { dismissedAt: null, ...scopeFor(user.id) },
      data: { dismissedAt: now, readAt: now },
    });

    revalidatePath('/notifications');
    return result.count;
  });
}
