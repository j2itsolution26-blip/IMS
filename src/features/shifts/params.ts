import 'server-only';

import { storeDb } from '@/lib/tenant/context';
import { resolveRangeFromParams, type DateRange, type PeriodKey } from '@/server/analytics/date-range';
import type { DiscrepancyFilter, ShiftListQuery, ShiftSort, ShiftView } from '@/server/services/shift-service';

/**
 * Turns Shift Management's query string into a validated list query. Shared
 * by the page and the export, so a download holds exactly the rows on screen.
 * Anything unrecognised falls back to the default rather than erroring; the
 * cashier id is only honoured if it belongs to someone who has had a shift.
 */

export type ShiftSearchParams = {
  view?: string;
  cashier?: string;
  discrepancy?: string;
  sort?: string;
  q?: string;
  period?: string;
  from?: string;
  to?: string;
  page?: string;
};

const VIEWS: ShiftView[] = ['open', 'closed', 'review'];
const DISCREPANCIES: DiscrepancyFilter[] = ['any', 'shortage', 'overage'];
const SORTS: ShiftSort[] = ['opened_desc', 'opened_asc', 'closed_desc', 'variance'];

const pick = <T extends string>(allowed: T[], value: string | undefined): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

export async function resolveShiftQuery(params: ShiftSearchParams): Promise<{
  query: ShiftListQuery;
  period: PeriodKey;
  range: DateRange;
  custom: { from: string; to: string } | null;
  cashiers: { id: string; name: string }[];
}> {
  const db = await storeDb();
  const { period, range, custom } = resolveRangeFromParams(params, 'week');
  const cashiers = await db.user.findMany({
    where: { shifts: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return {
    period,
    range,
    custom,
    cashiers,
    query: {
      from: range.from,
      to: range.to,
      userId: cashiers.some((c) => c.id === params.cashier) ? params.cashier : undefined,
      view: pick(VIEWS, params.view) ?? 'all',
      discrepancy: pick(DISCREPANCIES, params.discrepancy),
      sort: pick(SORTS, params.sort),
      search: params.q?.slice(0, 100),
      page: Number(params.page) || 1,
    },
  };
}
