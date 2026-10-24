import 'server-only';

import { cache } from 'react';
import type { PrismaClient } from '@prisma/client';
import { assertPasswordSettled, getCurrentUser } from '@/lib/session';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { storeAccess, type StoreAccess } from '@/lib/store-access';
import { storeClient } from '@/lib/tenant/client';

export interface StoreContext {
  storeId: string;
  /**
   * Prisma client that can only reach this store's rows. Read-only once the
   * subscription has lapsed past its grace period.
   */
  db: PrismaClient;
  /** What the subscription allows right now (plan, state, writable). */
  access: StoreAccess;
}

export const SUSPENDED_MESSAGE = 'This store has been suspended. Contact support to restore access.';

/**
 * The signed-in user's store and its scoped client.
 *
 * All store data is read and written through this, so it is also where a
 * suspended store is shut out and a lapsed one is made read-only. The store and
 * its subscription always come from the database on the server, and the time
 * from the server's clock, never from anything the browser sends.
 */
export const getStoreContext = cache(async (): Promise<StoreContext> => {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  // Every store query passes through here, so this one check keeps an account
  // with a pending password change away from all store data, whichever page,
  // action or route asked.
  assertPasswordSettled(user);
  if (!user.store) throw new ForbiddenError('This account does not belong to a store.');
  if (user.store.status === 'SUSPENDED') throw new ForbiddenError(SUSPENDED_MESSAGE);
  const access = storeAccess(user.store);
  return {
    storeId: user.store.id,
    db: storeClient(user.store.id, { writable: access.writable }),
    access,
  };
});

/** Shorthand for the many queries that only need the client. */
export async function storeDb(): Promise<PrismaClient> {
  return (await getStoreContext()).db;
}

/**
 * A writable client even for a read-only store, used for one thing only:
 * closing a shift that is already open, so a cashier is never left with a
 * drawer they cannot count. Suspended stores are still refused.
 */
export async function storeDbForShiftClose(): Promise<PrismaClient> {
  const { storeId } = await getStoreContext();
  return storeClient(storeId, { writable: true });
}
