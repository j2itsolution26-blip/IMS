'use server';

import { z } from 'zod';
import { authenticate, type CurrentUser } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ForbiddenError } from '@/lib/errors';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';
import {
  parseNotificationFilter,
  platformKindTone,
  safeNotificationHref,
  storeTypeTone,
  type NotificationItem,
} from '@/lib/notifications';
import { listPlatformNotificationsFor, markPlatformNotificationsRead } from '@/server/platform/platform-notification-service';
import { listNotifications, markNotificationsRead, syncOverdueShiftNotifications } from '@/server/services/notification-service';

/**
 * The bell's two actions, for whoever is signed in. The audience is decided
 * on the server from the account's permissions — never from the request:
 * a platform administrator sees platform notifications (with their own read
 * state); a store owner sees their store's. Nobody else has a bell, and no
 * request can read or mark another audience's notifications.
 */

type Audience = { scope: 'platform' | 'store'; user: CurrentUser };

async function audience(kind: 'read' | 'mutation'): Promise<Audience> {
  const user = await authenticate();
  checkRateLimit(`notifications:${kind}:${user.id}`, kind === 'read' ? RATE_LIMITS.read : RATE_LIMITS.mutation);
  if (user.permissions.has('platform.view')) return { scope: 'platform', user };
  if (user.permissions.has(FINANCIAL_PERMISSION)) return { scope: 'store', user };
  throw new ForbiddenError('You have no notifications.');
}

export interface NotificationPage {
  items: NotificationItem[];
  unread: number;
  total: number;
}

const listSchema = z.object({
  filter: z.enum(['all', 'unread']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export async function listMyNotificationsAction(input: unknown = {}): Promise<ActionResult<NotificationPage>> {
  return runAction(async () => {
    const { scope, user } = await audience('read');
    const values = parseInput(listSchema, input ?? {});
    const filter = parseNotificationFilter(values.filter);
    const limit = values.limit ?? 20;
    const skip = ((values.page ?? 1) - 1) * limit;

    if (scope === 'platform') {
      const result = await listPlatformNotificationsFor(user.id, { filter, take: limit, skip });
      return {
        unread: result.unread,
        total: result.total,
        items: result.items.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          href: safeNotificationHref(item.href),
          createdAt: item.createdAt,
          read: item.read,
          tone: platformKindTone(item.kind),
        })),
      };
    }

    // Raise any "left open" shift notices first, so the bell agrees with the shift list.
    await syncOverdueShiftNotifications();
    const result = await listNotifications(limit, { unreadOnly: filter === 'unread', skip });
    return {
      unread: result.unread,
      total: result.total,
      items: result.items.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        href: safeNotificationHref(item.href),
        createdAt: item.createdAt,
        read: item.read,
        tone: storeTypeTone(item.type),
      })),
    };
  });
}

const markSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(50).optional() });

export async function markMyNotificationsReadAction(input: unknown = {}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { scope, user } = await audience('mutation');
    const values = parseInput(markSchema, input ?? {});
    if (scope === 'platform') {
      await markPlatformNotificationsRead(user.id, values.ids);
    } else {
      // Scoped to the owner's store by the store client.
      await markNotificationsRead(user.id, values.ids);
    }
  });
}
