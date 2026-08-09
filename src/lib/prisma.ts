import { PrismaClient, Prisma } from '@prisma/client';

/**
 * A single PrismaClient per process. Next.js dev server hot-reloads modules,
 * which would otherwise open a new pool on every save and exhaust Supabase's
 * connection limit.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Transaction-scoped client. Services take this rather than the root client so
 * that several of them compose inside a single `$transaction`.
 */
export type TxClient = Prisma.TransactionClient;

/** Either client — for reads and for writes that stand alone. */
export type DbClient = PrismaClient | TxClient;

export { Prisma };
