import type { PrismaClient } from '@prisma/client';

/**
 * The per-month counters behind metered plan quotas (store_usage).
 *
 * Kept apart from entitlements.ts, with no server-only imports, so the
 * integration suite can race it against a real database.
 */

/**
 * Takes one unit, atomically: the counter is incremented only while it is
 * under `limit` (null = unlimited), in a single statement, so parallel calls
 * can never pass the limit. Returns false when the quota is used up.
 */
export async function takeUsageUnit(
  db: PrismaClient,
  storeId: string,
  metric: string,
  period: string,
  limit: number | null,
): Promise<boolean> {
  if (limit === null) {
    await db.$executeRaw`
      INSERT INTO store_usage ("storeId", metric, period, count, "updatedAt")
      VALUES (${storeId}, ${metric}, ${period}, 1, now())
      ON CONFLICT ("storeId", metric, period)
      DO UPDATE SET count = store_usage.count + 1, "updatedAt" = now()`;
    return true;
  }
  const taken = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO store_usage ("storeId", metric, period, count, "updatedAt")
    SELECT ${storeId}, ${metric}, ${period}, 1, now() WHERE ${limit}::int > 0
    ON CONFLICT ("storeId", metric, period)
    DO UPDATE SET count = store_usage.count + 1, "updatedAt" = now()
    WHERE store_usage.count < ${limit}::int
    RETURNING count`;
  return taken.length > 0;
}

/** Gives one unit back (the work it paid for failed). */
export async function returnUsageUnit(db: PrismaClient, storeId: string, metric: string, period: string): Promise<void> {
  await db.$executeRaw`
    UPDATE store_usage SET count = GREATEST(count - 1, 0), "updatedAt" = now()
    WHERE "storeId" = ${storeId} AND metric = ${metric} AND period = ${period}`;
}
