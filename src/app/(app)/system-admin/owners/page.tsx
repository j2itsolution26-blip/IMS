import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { listOwnerAccounts } from '@/features/platform/queries';
import { OwnerAccountsManager } from '@/features/platform/owner-accounts-manager';

export const metadata: Metadata = { title: 'Owner accounts' };
export const dynamic = 'force-dynamic';

export default async function OwnerAccountsPage() {
  await requirePermission('platform.view');
  const accounts = await listOwnerAccounts();

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Owner accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the store owner, reset their password, or suspend access. Store records are never
          deleted.
        </p>
      </div>

      <OwnerAccountsManager accounts={accounts} />
    </>
  );
}
