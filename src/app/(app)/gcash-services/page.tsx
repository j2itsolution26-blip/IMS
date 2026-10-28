import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeftRight, Coins, Smartphone, Wallet } from 'lucide-react';
import type { WalletTransactionType } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatCurrency, formatNumber } from '@/lib/format';
import { WALLET_TYPE_LABEL } from '@/lib/wallet';
import { getCompanyProfile, getCurrency } from '@/server/services/settings-service';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import { listWalletTransactions, walletServicesEnabled } from '@/server/services/wallet-service';
import { listMovementCashiers } from '@/server/services/cash-movement-queries';
import { KpiCard } from '@/components/kpi-card';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { WalletTable } from '@/features/wallet/wallet-table';

export const metadata: Metadata = { title: 'GCash Services' };
export const dynamic = 'force-dynamic';

const TYPES: WalletTransactionType[] = ['CASH_IN', 'CASH_OUT'];

/**
 * GCash cash-in / cash-out services: what moved, the fees earned, and the
 * effect on the drawers and on the store's GCash. Not part of sales. A
 * cashier sees their own; the owner sees every cashier's.
 */
export default async function GcashServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; cashier?: string; period?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await requirePermission('pos.view');
  const params = await searchParams;
  const isOwner = userCan(user, FINANCIAL_PERMISSION);
  const ownOnly = isOwner ? null : user.id;
  const { period, range, custom } = resolveRangeFromParams(params, 'today');

  const [currency, company, enabled, result, cashiers] = await Promise.all([
    getCurrency(),
    getCompanyProfile(),
    walletServicesEnabled(),
    listWalletTransactions({
      userId: ownOnly ?? (params.cashier || undefined),
      type: TYPES.includes(params.type as WalletTransactionType) ? (params.type as WalletTransactionType) : undefined,
      search: params.q,
      from: range.from,
      to: range.to,
      page: Number(params.page) || 1,
    }),
    isOwner ? listMovementCashiers() : [],
  ]);
  const label = inlineLabel(range);
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatCurrency(Math.abs(n), currency)}`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-title-lg">GCash Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash-in and cash-out done for customers. Kept apart from product sales; only the fee is income.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
          <Button asChild variant="outline" size="lg" className="h-11">
            <Link href="/cash-movements">
              <ArrowLeftRight /> Cash In / Out
            </Link>
          </Button>
        </div>
      </div>

      {!enabled && (
        <p role="status" className="mb-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          GCash services are turned off, so the POS does not offer them.{' '}
          {userCan(user, 'settings.view') ? (
            <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
              Turn them on in Settings
            </Link>
          ) : (
            'The owner can turn them on in Settings.'
          )}
          . Past entries stay here.
        </p>
      )}

      <section aria-label="GCash services summary" className="mb-4 grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Fees earned" value={formatCurrency(result.summary.fees, currency)} icon={Coins} hint={`${formatNumber(result.summary.count, 0)} service${result.summary.count === 1 ? '' : 's'} ${label}`} />
        <KpiCard
          label="Cash-in / cash-out"
          value={`${formatCurrency(result.summary.cashIn, currency)} / ${formatCurrency(result.summary.cashOut, currency)}`}
          icon={Smartphone}
          hint="GCash amounts, fees excluded"
        />
        <KpiCard label="Effect on drawers" value={signed(result.summary.drawerEffect)} icon={Wallet} hint="Counted in each shift’s expected cash" />
        <KpiCard label="Effect on store GCash" value={signed(result.summary.walletEffect)} icon={ArrowLeftRight} hint="Check against the store GCash app" />
      </section>

      <div className="mb-4 rounded-card border bg-card p-3 shadow-card [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Search GC-000123 or a GCash reference…"
          selects={[
            ...(isOwner
              ? [{ name: 'cashier', label: 'Cashier', allLabel: 'All cashiers', width: 'w-[170px]', options: cashiers.map((c) => ({ value: c.id, label: c.name })) }]
              : []),
            { name: 'type', label: 'Type', allLabel: 'Cash-in and cash-out', width: 'w-[190px]', options: TYPES.map((t) => ({ value: t, label: WALLET_TYPE_LABEL[t] })) },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title={`No GCash services ${label}`}
            description="Cashiers record GCash cash-in and cash-out from the POS shift bar while a shift is open."
          />
        ) : (
          <>
            <WalletTable rows={result.rows} currency={currency} viewerId={user.id} isOwner={isOwner} storeName={company.name} />
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
