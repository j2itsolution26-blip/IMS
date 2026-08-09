import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileBarChart } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getReport } from '@/server/reports/registry';
import { parsePeriod, resolveRange } from '@/server/analytics/date-range';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { EmptyState } from '@/components/empty-state';
import { Card } from '@/components/ui/card';
import { ExportMenu } from '@/features/reports/export-menu';
import { ReportTable } from '@/features/reports/report-table';
import { formatCurrency } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ report: string }>;
}): Promise<Metadata> {
  const { report: id } = await params;
  return { title: getReport(id)?.name ?? 'Report' };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ report: id }, query] = await Promise.all([params, searchParams]);

  const report = getReport(id);
  if (!report) notFound();

  const user = await requirePermission(report.permission);

  const period = parsePeriod(query.period, 'last30');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const result = await report.load(range, currency);

  return (
    <>
      <PageHeader
        title={report.name}
        description={report.description}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: report.name }]}
        actions={
          <>
            {report.usesDateRange && <PeriodPicker current={period} />}
            {userCan(user, 'reports.export') && (
              <ExportMenu reportId={report.id} period={report.usesDateRange ? period : undefined} />
            )}
          </>
        }
      />

      {result.summary && result.summary.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {result.summary.map((item) => (
            <Card key={item.label} className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {/* Summary values arrive as raw numbers so the currency can be
                    applied here rather than baked into the report. */}
                {Number.isFinite(Number(item.value))
                  ? item.label.toLowerCase().includes('transaction')
                    ? Number(item.value).toLocaleString()
                    : formatCurrency(Number(item.value), currency)
                  : item.value}
              </p>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-lg border">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="No data for this report"
            description={
              report.usesDateRange
                ? 'Nothing was recorded in the selected period. Try widening the date range.'
                : 'There is nothing to report on yet. This will fill in as you trade.'
            }
          />
        ) : (
          <ReportTable columns={result.columns} rows={result.rows} currency={currency} />
        )}
      </div>
    </>
  );
}
