import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, CalendarClock, ClipboardCheck, ScrollText, ShieldCheck } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import {
  AUDIT_CATEGORY_LABEL,
  AUDIT_CATEGORY_ORDER,
  AUDIT_SEVERITY_LABEL,
  AUDIT_SEVERITY_ORDER,
  auditWindowLabel,
  auditWindowStart,
  parseAuditCategory,
  parseAuditSeverity,
} from '@/lib/audit-log';
import { formatDate, formatNumber } from '@/lib/format';
import { inlineLabel, resolveRangeFromParams } from '@/server/analytics/date-range';
import {
  STORE_WIDE_ONLY_MESSAGE,
  getStoreAuditSummary,
  isStoreWideAuditViewer,
  listAuditActors,
  listStoreAudit,
} from '@/server/services/audit-queries';
import { PageHeader } from '@/components/page-header';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { PeriodPicker } from '@/components/period-picker';
import { EmptyState } from '@/components/empty-state';
import { KpiCard } from '@/components/kpi-card';
import { AuditActivityList } from '@/features/audit/audit-activity-list';

export const metadata: Metadata = { title: 'Audit & Activity Center' };
export const dynamic = 'force-dynamic';

const DEFAULT_PERIOD = 'last30';

/**
 * The store's audit and activity center: who did what and when, read-only.
 * Everything is filtered, counted and paged on the server; how far back it
 * reaches is the plan's audit history (listStoreAudit applies it). Older
 * entries are kept, just not shown.
 */
export default async function AuditActivityCenterPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    severity?: string;
    staff?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('audit.view');
  if (!(await isStoreWideAuditViewer())) {
    return (
      <>
        <PageHeader title="Audit & Activity Center" />
        <div className="rounded-card border bg-card shadow-card">
          <EmptyState icon={ShieldCheck} title="Not available for your account" description={STORE_WIDE_ONLY_MESSAGE} />
        </div>
      </>
    );
  }
  const params = await searchParams;
  const ctx = await getStoreContext();
  const days = ctx.access.plan.auditHistoryDays;

  const { period, range, custom } = resolveRangeFromParams(params, DEFAULT_PERIOD);
  // "All time" is the plan's whole window.
  const from = period === 'all' ? null : range.from;
  const to = period === 'all' ? null : range.to;
  const windowStart = auditWindowStart(days);
  const clipped = Boolean(windowStart && from && from < windowStart);
  // Reads mid-sentence: "in the last 30 days", "today", "from 1 Oct 2026 – 5 Oct 2026".
  const rangeLabel =
    period === 'all'
      ? `in ${auditWindowLabel(days)}`
      : range.isCustom
        ? `from ${range.label}`
        : /^last \d/.test(inlineLabel(range))
          ? `in the ${inlineLabel(range)}`
          : inlineLabel(range);

  const category = parseAuditCategory(params.category);
  const severity = parseAuditSeverity(params.severity);
  const filtered = Boolean(params.q || category || severity || params.staff);

  const [result, summary, actors] = await Promise.all([
    listStoreAudit({ category, severity, userId: params.staff || null, search: params.q, from, to, page: Number(params.page) || 1 }),
    getStoreAuditSummary({ from, to }),
    listAuditActors(),
  ]);

  return (
    <>
      <PageHeader
        title="Audit & Activity Center"
        description="Track store activity, sign-in and security events, and changes to stock, staff and settings. Read-only, newest first."
      />

      <section aria-label="Activity summary" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Total events" value={formatNumber(summary.total, 0)} icon={Activity} hint={`Logged ${rangeLabel}`} />
        <KpiCard label="Today's activities" value={formatNumber(summary.today, 0)} icon={CalendarClock} hint="Since midnight, store time" />
        <KpiCard
          label="Security events"
          value={formatNumber(summary.security, 0)}
          icon={ShieldCheck}
          tone={summary.securityFlagged > 0 ? 'warning' : 'default'}
          hint={
            summary.securityFlagged > 0
              ? `${formatNumber(summary.securityFlagged, 0)} need attention ${rangeLabel}`
              : `Sign-ins, PINs, passkeys and passwords ${rangeLabel}`
          }
          href="/settings/audit?category=security"
        />
        <KpiCard
          label="Needs review"
          value={formatNumber(summary.shiftsAwaitingReview, 0)}
          icon={ClipboardCheck}
          tone={summary.shiftsAwaitingReview > 0 ? 'warning' : 'default'}
          hint={summary.shiftsAwaitingReview > 0 ? 'Shifts closed short or over' : 'No shift is waiting for review'}
          href="/shifts?view=review"
        />
      </section>

      <div className="mb-4 rounded-card border bg-card p-3 shadow-card [&>div]:mb-0">
        <FilterBar
          searchPlaceholder="Search activity, staff, @username or INV-…"
          extraActive={period !== DEFAULT_PERIOD ? 1 : 0}
          selects={[
            {
              name: 'category',
              label: 'Activity',
              allLabel: 'All activity',
              width: 'w-[200px]',
              options: AUDIT_CATEGORY_ORDER.map((key) => ({ value: key, label: AUDIT_CATEGORY_LABEL[key] })),
            },
            {
              name: 'severity',
              label: 'Severity',
              allLabel: 'Any severity',
              width: 'w-[150px]',
              options: AUDIT_SEVERITY_ORDER.map((key) => ({ value: key, label: AUDIT_SEVERITY_LABEL[key] })),
            },
            {
              name: 'staff',
              label: 'Person',
              allLabel: 'Everyone',
              width: 'w-[170px]',
              options: actors.map((actor) => ({ value: actor.id, label: actor.name })),
            },
          ]}
        >
          <PeriodPicker current={period} allowCustom customFrom={custom?.from} customTo={custom?.to} />
        </FilterBar>
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {formatNumber(result.total, 0)} {result.total === 1 ? 'event' : 'events'} {rangeLabel}
          {filtered ? ' that match your filters' : ''}.
          {clipped && windowStart && <> Your plan shows entries from {formatDate(windowStart)} onwards.</>}
        </p>
      </div>

      {result.hiddenOlder > 0 && (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {formatNumber(result.hiddenOlder, 0)} older {result.hiddenOlder === 1 ? 'entry is' : 'entries are'} kept but not shown on
          your {ctx.access.plan.name} plan, which shows {auditWindowLabel(days)}. Nothing is deleted.
          {userCan(user, 'billing.view') && (
            <>
              {' '}
              <Link href="/settings/subscription" className="font-medium text-foreground underline-offset-4 hover:underline">
                See plans with longer history
              </Link>
            </>
          )}
        </p>
      )}

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtered ? 'No activity matches these filters' : `No activity ${rangeLabel}`}
            description={
              filtered
                ? 'Try a wider date range, another category or a shorter search.'
                : 'Sign-ins, sales, refunds, voids, shifts, cash, stock, staff, settings and billing all appear here as they happen.'
            }
          />
        ) : (
          <>
            <AuditActivityList rows={result.rows} />
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
