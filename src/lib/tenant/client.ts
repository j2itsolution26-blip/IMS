import type { PrismaClient } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { StoreReadOnlyError } from '@/lib/errors';
import { StoreScopeError, foreignKeysToVerify, isRawWrite, isReadOnlyRefused, scopeArgs } from '@/lib/tenant/scope';

/**
 * A Prisma client confined to one store.
 *
 * Every model call made through it, including inside `$transaction`, is
 * rewritten by `scopeArgs` so it can only read or write that store's rows.
 * Raw SQL (`$queryRaw`) cannot be rewritten: those queries filter by store
 * themselves, which the integration suite checks.
 *
 * A read-only client (a store whose subscription has lapsed past its grace
 * period) refuses every write — model writes and raw SQL that writes — so no
 * server action can change data, whichever path it takes. Only audit entries
 * are still recorded.
 *
 * Typed as a plain `PrismaClient` on purpose: the extension changes arguments
 * at run time but no types, so every existing service signature keeps working.
 */

const clients = new Map<string, PrismaClient>();

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function createStoreClient(storeId: string, writable: boolean): PrismaClient {
  const refuseRawWrite = (args: unknown) => {
    if (!writable && isRawWrite(args)) throw new StoreReadOnlyError();
  };

  const extended = platformPrisma.$extends({
    name: writable ? 'store-scope' : 'store-scope-read-only',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!writable && isReadOnlyRefused(model, operation)) throw new StoreReadOnlyError();
          // Rows scoped through a relation (role permissions, sessions) have no
          // store column to tag, so the rows they point at are checked first.
          const check = foreignKeysToVerify(model, operation, args);
          if (check && check.ids.length > 0) {
            const delegate = (platformPrisma as unknown as Record<string, { count: (q: unknown) => Promise<number> }>)[
              delegateName(check.target)
            ];
            const owned = await delegate.count({ where: { id: { in: check.ids }, storeId } });
            if (owned !== check.ids.length) {
              throw new StoreScopeError(`${model} refers to a ${check.target} of another store`);
            }
          }
          return query(scopeArgs(model, operation, args, storeId) as typeof args);
        },
      },
      async $queryRaw({ args, query }) {
        refuseRawWrite(args);
        return query(args);
      },
      async $executeRaw({ args, query }) {
        refuseRawWrite(args);
        return query(args);
      },
      async $queryRawUnsafe({ args, query }) {
        refuseRawWrite(args);
        return query(args);
      },
      async $executeRawUnsafe({ args, query }) {
        refuseRawWrite(args);
        return query(args);
      },
    },
  });
  return extended as unknown as PrismaClient;
}

/** The scoped client for a store. Clients are reused, one per store and mode. */
export function storeClient(storeId: string, { writable = true }: { writable?: boolean } = {}): PrismaClient {
  if (!storeId) throw new StoreScopeError('no store selected');
  const key = `${storeId}:${writable ? 'rw' : 'ro'}`;
  let client = clients.get(key);
  if (!client) {
    client = createStoreClient(storeId, writable);
    clients.set(key, client);
  }
  return client;
}
