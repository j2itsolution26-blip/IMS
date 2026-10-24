import type { Metadata } from 'next';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { listStores } from '@/features/platform/queries';
import { formatDate, formatNumber } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { storeAccess } from '@/lib/store-access';
import { STATUS_LABEL, daysUntil } from '@/lib/subscription';
import { Panel, PanelEmpty } from '@/components/panel';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AccessBadge } from '@/features/subscription/plan-display';
import { CreateStoreButton } from '@/features/platform/store-subscription-manager';

export const metadata: Metadata = { title: 'Stores' };
export const dynamic = 'force-dynamic';

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requirePermission('platform.view');
  const { q } = await searchParams;
  const stores = await listStores(q);
  const now = new Date();

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-title-lg">Stores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every store&apos;s plan, subscription and usage. Open a store to change its plan or record a payment.
          </p>
        </div>
        {userCan(admin, 'platform.manage') && <CreateStoreButton />}
      </div>

      <form className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="store-search" className="sr-only">
          Search stores
        </label>
        <Input id="store-search" name="q" defaultValue={q ?? ''} placeholder="Store, owner name, username or email" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <Panel title={`${formatNumber(stores.length, 0)} store${stores.length === 1 ? '' : 's'}`}>
        {stores.length === 0 ? (
          <PanelEmpty icon={Store} title="No stores found" description={q ? 'Try a different search.' : 'Create the first store.'} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Stores and their subscriptions</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="h-10 px-4 font-semibold">Store</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Access</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Ends</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">Products</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">Staff</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => {
                  const access = storeAccess(store, now);
                  const days = daysUntil(access.endsAt, now);
                  return (
                    <tr key={store.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/system-admin/stores/${store.id}`} className="font-medium text-primary hover:underline">
                          {store.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {store.ownerUsername ? `@${store.ownerUsername}` : 'No owner yet'} · created {formatDate(store.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        {access.plan.name}
                        {store.status === 'TRIAL' && store.plan !== access.plan.id && (
                          <span className="block text-xs text-muted-foreground">bought {PLANS[store.plan].name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <AccessBadge state={access.state} />
                        <span className="block text-xs text-muted-foreground">{STATUS_LABEL[store.status]}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {access.endsAt ? formatDate(access.endsAt) : 'No end date'}
                        {days !== null && days > 0 && <span className="block text-xs text-muted-foreground">in {days} day{days === 1 ? '' : 's'}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatNumber(store.products, 0)}
                        <span className="text-xs text-muted-foreground"> / {PLANS[access.plan.id].limits.products ?? '∞'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatNumber(store.staff, 0)}
                        <span className="text-xs text-muted-foreground"> / {PLANS[access.plan.id].limits.staff ?? '∞'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
