import type { Prisma } from '@prisma/client';

/** Atomically take the next number of a named yearly sequence. */
export async function nextNumber(tx: Prisma.TransactionClient, key: string): Promise<number> {
  const row = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}
