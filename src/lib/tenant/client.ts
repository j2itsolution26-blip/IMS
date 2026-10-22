import type { PrismaClient } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { StoreScopeError, foreignKeysToVerify, scopeArgs } from '@/lib/tenant/scope';

/**
 * A Prisma client confined to one store.
 *
 * Every model call made through it, including inside `$transaction`, is
 * rewritten by `scopeArgs` so it can only read or write that store's rows.
 * Raw SQL (`$queryRaw`) cannot be rewritten: those queries filter by store
 * themselves, which tests/tenant-raw-sql.test.ts checks.
 *
 * Typed as a plain `PrismaClient` on purpose: the extension changes arguments
 * at run time but no types, so every existing service signature keeps working.
 */

const clients = new Map<string, PrismaClient>();

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function createStoreClient(storeId: string): PrismaClient {
  const extended = platformPrisma.$extends({
    name: 'store-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
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
    },
  });
  return extended as unknown as PrismaClient;
}

/** The scoped client for a store. Clients are reused, one per store. */
export function storeClient(storeId: string): PrismaClient {
  if (!storeId) throw new StoreScopeError('no store selected');
  let client = clients.get(storeId);
  if (!client) {
    client = createStoreClient(storeId);
    clients.set(storeId, client);
  }
  return client;
}
