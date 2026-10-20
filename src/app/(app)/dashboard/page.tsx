import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, requirePermission, userCan, type CurrentUser } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { resolveDashboardVariant } from '@/lib/dashboard-access';
import { cn } from '@/lib/utils';
import { resolveRangeFromParams } from '@/server/analytics/date-range';
import { getDashboardOverview } from '@/server/analytics/dashboard-overview';
import { getInventoryDashboard, getInventoryKpis } from '@/server/analytics/inventory-dashboard';
import { getStockLevels } from '@/server/analytics/inventory-analytics';
import { getOpenShift, previewShiftClose } from '@/server/services/shift-service';
import { getSettings, readString } from '@/server/services/settings-service';
import { DASHBOARD_PERIODS, DashboardView, type DashboardQuery } from '@/features/dashboard/dashboard-view';
import {
  ATTENTION_FILTERS,
  InventoryDashboardView,
  type AttentionFilter,
} from '@/features/dashboard/inventory/inventory-dashboard-view';
import { CashierDashboardView } from '@/features/dashboard/cashier-dashboard-view';
import { AccessDenied } from '@/features/dashboard/access-denied';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is live; caching would show yesterday's numbers.
export const dynamic = 'force-dynamic';

type SearchParams = {
  period?: string;
  from?: string;
  to?: string;
  top?: string;
  view?: string;
  status?: string;
  q?: string;
  page?: string;
};

/**
 * The dashboard, chosen on the server by what the signed-in role may see.
 *
 *   Owner           — Sales Dashboard (with cost and profit), plus the
 *                     Inventory Operations view under ?view=inventory
 *   Inventory Staff — Inventory Operations Dashboard only
 *   Cashier         — Till dashboard: own shift, availability, low stock
 *   Platform admin  — redirected to /system-admin
 *
 * Only the chosen variant's queries run, so a role never receives — in the
 * page or its payload — figures it is not entitled to. This is the access
 * control; nothing is hidden with CSS.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const signedIn = await requireUser();
  const variant = resolveDashboardVariant(signedIn.permissions);

  // A platform administrator holds no store permissions, so the dashboard is
  // not theirs to see. Sending them to their own screen beats bouncing them
  // off a permission check on the page every sign-in lands on.
  if (variant === 'platform') redirect('/system-admin');

  const user = await requirePermission('dashboard.view');
  const params = await searchParams;
  const settings = await getSettings();
  const currency = readString(settings, 'locale.currency') || 'PHP';

  if (variant === 'none') return <AccessDenied />;

  if (variant === 'cashier') return renderCashier(user, currency);

  if (variant === 'inventory') {
    return renderInventory({ user, params, currency, includeValue: false, header: <InventoryHeader /> });
  }

  // Owner
  if (params.view === 'inventory') {
    return renderInventory({
      user,
      params,
      currency,
      includeValue: userCan(user, FINANCIAL_PERMISSION),
      baseParams: { view: 'inventory' },
      header: (
        <>
          <OwnerTabs active="inventory" />
          <InventoryHeader />
        </>
      ),
    });
  }

  return renderOwnerSales(user, params, currency, readString(settings, 'company.name') || 'My Store');
}

/* -------------------------------------------------------------------------- */

async function renderOwnerSales(user: CurrentUser, params: SearchParams, currency: string, storeName: string) {
  // Only this screen's presets are honoured; an old link to "last 30 days"
  // lands on today rather than on a choice the picker cannot show.
  const offered = params.period === 'custom' || DASHBOARD_PERIODS.some((p) => p.value === params.period);
  const { period, range, custom } = resolveRangeFromParams(offered ? params : {}, 'today');

  const rangeNotice =
    params.period === 'custom' && !custom
      ? 'That custom date range could not be read or is longer than five years, so today is shown instead.'
      : null;

  const query: DashboardQuery = {
    period,
    from: custom?.from,
    to: custom?.to,
    top: params.top === '10' ? 10 : 5,
  };

  const now = new Date();
  const data = await getDashboardOverview({
    range,
    topLimit: query.top,
    canViewProfit: userCan(user, FINANCIAL_PERMISSION),
    now,
  });

  return (
    <DashboardView
      tabs={<OwnerTabs active="sales" />}
      storeName={storeName}
      query={query}
      range={range}
      rangeNotice={rangeNotice}
      currency={currency}
      generatedAt={now.toISOString()}
      data={data}
    />
  );
}

const ATTENTION_PAGE_SIZE = 10;

async function renderInventory({
  user,
  params,
  currency,
  includeValue,
  baseParams,
  header,
}: {
  user: CurrentUser;
  params: SearchParams;
  currency: string;
  includeValue: boolean;
  baseParams?: Record<string, string>;
  header: ReactNode;
}) {
  const status: AttentionFilter = ATTENTION_FILTERS.some((f) => f.value === params.status)
    ? (params.status as AttentionFilter)
    : 'ALL';
  const q = (params.q ?? '').trim().slice(0, 80);

  const [data, attention] = await Promise.all([
    getInventoryDashboard({ includeValue }),
    getStockLevels({
      status,
      search: q || null,
      sort: 'attention',
      page: Number(params.page) || 1,
      pageSize: ATTENTION_PAGE_SIZE,
    }),
  ]);

  return (
    <InventoryDashboardView
      header={header}
      data={data}
      attention={attention}
      attentionQuery={{ status, q }}
      basePath="/dashboard"
      baseParams={baseParams}
      currency={currency}
      canAdjustStock={userCan(user, 'inventory.create')}
      canEditProduct={userCan(user, 'products.update')}
    />
  );
}

async function renderCashier(user: CurrentUser, currency: string) {
  const shift = await getOpenShift(user.id);
  const [shiftTotals, kpis, out, low] = await Promise.all([
    // The cashier's own shift only — never the store's takings.
    shift ? previewShiftClose(user.id) : null,
    getInventoryKpis(),
    getStockLevels({ status: 'OUT_OF_STOCK', sort: 'name', page: 1, pageSize: 10 }),
    getStockLevels({ status: 'LOW_ANY', sort: 'attention', page: 1, pageSize: 10 }),
  ]);

  return (
    <CashierDashboardView
      cashierName={user.name}
      shift={shift}
      shiftTotals={shiftTotals}
      kpis={kpis}
      runningOut={[...out.rows, ...low.rows].slice(0, 10)}
      canSell={userCan(user, 'pos.create')}
      currency={currency}
    />
  );
}

/* -------------------------------------------------------------------------- */

function InventoryHeader() {
  return (
    <div className="mb-5 min-w-0">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Inventory Operations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Stock levels, restocking and stock movements. Every quantity is in pieces.
      </p>
    </div>
  );
}

/** The owner's switch between the two dashboards. */
function OwnerTabs({ active }: { active: 'sales' | 'inventory' }) {
  const tabs = [
    { value: 'sales', label: 'Sales', href: '/dashboard' },
    { value: 'inventory', label: 'Inventory', href: '/dashboard?view=inventory' },
  ] as const;
  return (
    <nav aria-label="Dashboard view" className="mb-4 inline-flex rounded-lg border bg-card p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          aria-current={active === tab.value ? 'page' : undefined}
          className={cn(
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            active === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
