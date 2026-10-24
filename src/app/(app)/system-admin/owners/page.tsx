import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { countStoresAwaitingOwner, listOwnerAccounts } from '@/features/platform/queries';
import { OwnerAccountsManager } from '@/features/platform/owner-accounts-manager';

export const metadata: Metadata = { title: 'Owner accounts' };
export const dynamic = 'force-dynamic';

export default async function OwnerAccountsPage() {
  await requirePermission('platform.view');
  const [accounts, storesAwaitingOwner] = await Promise.all([listOwnerAccounts(), countStoresAwaitingOwner()]);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-title sm:text-title-lg">Owner accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the store owner, reset their password, or suspend access. Store records are never
          deleted.
        </p>
      </div>

      <OwnerAccountsManager accounts={accounts} storesAwaitingOwner={storesAwaitingOwner} />
    </>
  );
}
