import 'server-only';

import { cache } from 'react';
import type { PrismaClient } from '@prisma/client';
import { getCurrentUser } from '@/lib/session';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { storeClient } from '@/lib/tenant/client';

export interface StoreContext {
  storeId: string;
  /** Prisma client that can only reach this store's rows. */
  db: PrismaClient;
}

export const SUSPENDED_MESSAGE = 'This store has been suspended. Contact support to restore access.';

/**
 * The signed-in user's store and its scoped client.
 *
 * All store data is read and written through this, so it is also where a
 * suspended store is shut out. The store always comes from the session on the
 * server, never from anything the browser sends.
 */
export const getStoreContext = cache(async (): Promise<StoreContext> => {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (!user.store) throw new ForbiddenError('This account does not belong to a store.');
  if (user.store.status === 'SUSPENDED') throw new ForbiddenError(SUSPENDED_MESSAGE);
  return { storeId: user.store.id, db: storeClient(user.store.id) };
});

/** Shorthand for the many queries that only need the client. */
export async function storeDb(): Promise<PrismaClient> {
  return (await getStoreContext()).db;
}
