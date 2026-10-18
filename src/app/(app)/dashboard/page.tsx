import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser, requirePermission, userCan } from '@/lib/session';
import { resolveRangeFromParams } from '@/server/analytics/date-range';
import { getDashboardOverview } from '@/server/analytics/dashboard-overview';
import { getSettings, readString } from '@/server/services/settings-service';
import { DASHBOARD_PERIODS, DashboardView, type DashboardQuery } from '@/features/dashboard/dashboard-view';

export const metadata: Metadata = { title: 'Sales Dashboard' };

// Every figure is live; caching would show the owner yesterday's numbers.
export const dynamic = 'force-dynamic';

/**
 * Cost and profit are the owner's. `reports.export` is held by the Owner and
 * by no default staff role, so it is the gate for anything built on cost.
 */
const PROFIT_PERMISSION = 'reports.export';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; top?: string; sort?: string }>;
}) {
  // A platform administrator holds no store permissions, so the dashboard is
  // not theirs to see. Sending them to their own screen beats bouncing them
  // off a permission check on the page every sign-in lands on.
  const signedIn = await requireUser();
  if (!userCan(signedIn, 'dashboard.view') && userCan(signedIn, 'platform.view')) {
    redirect('/system-admin');
  }

  const user = await requirePermission('dashboard.view');
  const params = await searchParams;

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
    sort: params.sort === 'revenue' ? 'revenue' : 'units',
  };

  const now = new Date();
  const [settings, data] = await Promise.all([
    getSettings(),
    getDashboardOverview({
      range,
      topLimit: query.top,
      topSort: query.sort,
      canViewProfit: userCan(user, PROFIT_PERMISSION),
      now,
    }),
  ]);

  return (
    <DashboardView
      storeName={readString(settings, 'company.name') || 'My Store'}
      query={query}
      range={range}
      rangeNotice={rangeNotice}
      currency={readString(settings, 'locale.currency') || 'PHP'}
      generatedAt={now.toISOString()}
      data={data}
    />
  );
}
