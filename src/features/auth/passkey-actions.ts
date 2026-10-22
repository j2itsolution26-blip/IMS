'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authenticate } from '@/lib/session';
import { platformPrisma } from '@/lib/prisma';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { NotFoundError } from '@/lib/errors';
import { recordAuditFor } from '@/server/services/audit-service';

/**
 * Managing your own passkeys. Every query is scoped to the signed-in user's
 * id, so one account can never rename or remove another's passkey — an
 * unknown id and someone else's id both read as "not found".
 *
 * Revoking a staff member's passkeys is an administrator action and lives
 * with the other account actions (`revokeUserPasskeys`).
 */

const renameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Give the passkey a name.').max(60),
});

export async function renamePasskey(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authenticate();
    const values = parseInput(renameSchema, input);

    const { count } = await platformPrisma.passkey.updateMany({
      where: { id: values.id, userId: user.id },
      data: { name: values.name },
    });
    if (count === 0) throw new NotFoundError('Passkey');

    revalidatePath('/settings/profile');
  });
}

export async function removePasskey(id: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authenticate();
    const passkeyId = parseInput(z.string().min(1), id);

    const removed = await platformPrisma.passkey.findFirst({
      where: { id: passkeyId, userId: user.id },
      select: { name: true },
    });
    const { count } = await platformPrisma.passkey.deleteMany({ where: { id: passkeyId, userId: user.id } });
    if (count === 0) throw new NotFoundError('Passkey');

    await recordAuditFor(user, {
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      summary: `Removed a passkey (${removed?.name ?? 'Passkey'})`,
      userId: user.id,
    });

    revalidatePath('/settings/profile');
  });
}
