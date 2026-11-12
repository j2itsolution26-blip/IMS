import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

type Db = PrismaClient | Prisma.TransactionClient;

export async function audit(
  entry: { userId: string | null; action: string; entity: string; entityId?: string; summary: string },
  db: Db = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? '',
      summary: entry.summary.slice(0, 500),
    },
  });
}
