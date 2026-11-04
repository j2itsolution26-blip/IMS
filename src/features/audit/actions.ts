'use server';

import { authorize } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/action';
import { NotFoundError } from '@/lib/errors';
import { assertStoreWideAuditViewer, getStoreAuditEntry, type StoreAuditEntry } from '@/server/services/audit-queries';

/**
 * One activity entry for the detail drawer. Read-only: the permission, the
 * branch scope, the store and the plan window are all checked on the server,
 * and secrets are masked before anything leaves it.
 */
export async function getAuditEntryAction(id: unknown): Promise<ActionResult<StoreAuditEntry>> {
  return runAction(async () => {
    await authorize('audit.view');
    await assertStoreWideAuditViewer();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new NotFoundError('Activity entry');
    const entry = await getStoreAuditEntry(id);
    if (!entry) throw new NotFoundError('Activity entry');
    return entry;
  });
}
