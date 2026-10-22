import { PrismaClient, Prisma } from '@prisma/client';

/**
 * A single PrismaClient per process. Next.js dev server hot-reloads modules,
 * which would otherwise open a new pool on every save and exhaust Supabase's
 * connection limit.
 *
 * This is the PLATFORM client: it sees every store. Store data must be read
 * and written through `getStoreContext()` / `storeDb()` from
 * `@/lib/tenant/context`, whose client is confined to the signed-in user's
 * store. ESLint only allows importing this from authentication, platform
 * administration and the tenant layer itself (see eslint.config.mjs).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const platformPrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = platformPrisma;
}

/**
 * Transaction-scoped client. Services take this rather than the root client so
 * that several of them compose inside a single `$transaction`.
 */
export type TxClient = Prisma.TransactionClient;

/** Either client — for reads and for writes that stand alone. */
export type DbClient = PrismaClient | TxClient;

export { Prisma };
