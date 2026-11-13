import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CloudOff, Smartphone } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatCurrency, formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { shiftReference } from '@/lib/shift-review';
import { syncIssueAction, type DeviceState } from '@/lib/sync-review';
import { getCurrency } from '@/server/services/settings-service';
import { getSyncOverview, listDevices, listSyncIssues } from '@/server/services/sync-review-service';
import { KpiCard } from '@/components/kpi-card';
import { EmptyState } from '@/components/empty-state';
import { PaginationBar } from '@/components/filter-bar';
import { Badge } from '@/components/ui/badge';
import { SalesTabs } from '@/features/sales/sales-tabs';
import { DeviceAccessButton, ResolveIssueButton } from '@/features/offline/review-controls';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Offline sync' };
export const dynamic = 'force-dynamic';

const STATE_BADGE: Record<DeviceState, { label: string; variant: 'success' | 'secondary' | 'destructive' }> = {
  active: { label: 'Active', variant: 'success' },
  idle: { label: 'Not seen lately', variant: 'secondary' },
  revoked: { label: 'Removed', variant: 'destructive' },
};

/**
 * The owner's review of offline selling: sales that reached the server with
 * something to check, and the devices allowed to sell offline. Every sale
 * here is already recorded as charged; resolving an issue records what the
 * owner checked, and never changes the sale.
 */
export default async function OfflineSyncPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await requirePermission(FINANCIAL_PERMISSION);
  const params = await searchParams;
  const status = params.status === 'resolved' ? 'RESOLVED' : 'OPEN';

  const [currency, overview, issues, devices] = await Promise.all([
    getCurrency(),
    getSyncOverview(),
    listSyncIssues({ status, page: Number(params.page) || 1 }),
    listDevices(),
  ]);
  const money = (value: number) => formatCurrency(value, currency);

  return (
    <>
      <SalesTabs current="offline" showOffline />
      <div className="mb-5 min-w-0">
        <h1 className="text-title sm:text-title-lg">Offline sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sales made while a till had no connection, once they reach the server, and the devices allowed to sell offline.
        </p>
      </div>

      <section aria-label="Offline selling summary" className="mb-5 grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Needs review"
          value={formatNumber(overview.openIssues, 0)}
          icon={AlertTriangle}
          tone={overview.openIssues > 0 ? 'warning' : 'success'}
          hint={overview.openIssues > 0 ? 'Offline sales with something to check' : 'Nothing waiting'}
        />
        <KpiCard
          label="Offline sales, last 30 days"
          value={money(overview.offlineSales30d.total)}
          icon={CloudOff}
          hint={`${formatNumber(overview.offlineSales30d.count, 0)} sale${overview.offlineSales30d.count === 1 ? '' : 's'}, already in sales and reports`}
        />
        <KpiCard
          label="Devices"
          value={formatNumber(overview.devices.active, 0)}
          icon={Smartphone}
          hint={overview.devices.revoked > 0 ? `${overview.devices.revoked} removed` : 'Allowed to sell offline'}
        />
      </section>

      <section aria-labelledby="issues-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="issues-heading" className="text-base font-semibold">
            Sales to review
          </h2>
          <nav aria-label="Issue status" className="inline-flex rounded-full bg-muted p-1">
            {(
              [
                ['OPEN', 'To review', '/sales/offline'],
                ['RESOLVED', 'Resolved', '/sales/offline?status=resolved'],
              ] as const
            ).map(([value, label, href]) => (
              <Link
                key={value}
                href={href}
                aria-current={status === value ? 'page' : undefined}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  status === value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="overflow-hidden rounded-card border bg-card shadow-card">
          {issues.rows.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={status === 'OPEN' ? 'Nothing to review' : 'Nothing resolved yet'}
              description="When an offline sale arrives with a stock, price, tax or shift difference, it is listed here. The sale is recorded either way."
            />
          ) : (
            <>
              <ul className="divide-y">
                {issues.rows.map((issue) => (
                  <li key={issue.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={issue.status === 'OPEN' ? 'warning' : 'success'}>{issue.label}</Badge>
                        <Link href={`/sales/${issue.sale.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                          {issue.sale.invoiceNumber}
                        </Link>
                        {issue.sale.localReceiptNumber && (
                          <span className="font-mono text-xs text-muted-foreground">receipt {issue.sale.localReceiptNumber}</span>
                        )}
                      </div>
                      <p className="text-sm">{issue.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {money(issue.sale.total)} · sold {formatDateTime(issue.sale.soldAt)} by {issue.sale.cashierName} · reached the server{' '}
                        {formatDateTime(issue.sale.receivedAt)} · {issue.branchName}
                        {issue.deviceLabel ? ` · ${issue.deviceLabel}` : ''}
                        {issue.shift && (
                          <>
                            {' · '}
                            <Link href={`/shifts/${issue.shift.id}`} className="hover:underline">
                              shift {shiftReference(issue.shift.number)}
                            </Link>
                          </>
                        )}
                      </p>
                      {issue.resolved ? (
                        <p className="text-xs text-success-text">
                          Resolved {formatDateTime(issue.resolved.at)}
                          {issue.resolved.by ? ` by ${issue.resolved.by}` : ''}
                          {issue.resolved.note ? `: ${issue.resolved.note}` : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">{syncIssueAction(issue.kind)}</p>
                      )}
                    </div>
                    {issue.status === 'OPEN' && (
                      <div className="shrink-0">
                        <ResolveIssueButton issueId={issue.id} title={issue.label} guidance={syncIssueAction(issue.kind)} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <PaginationBar page={issues.page} pageCount={issues.pageCount} total={issues.total} />
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="devices-heading">
        <h2 id="devices-heading" className="mb-1 text-base font-semibold">
          Devices
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          A device is added when a cashier opens the till on it with offline sales switched on. Remove one that is lost or no longer used.
        </p>
        <div className="overflow-hidden rounded-card border bg-card shadow-card">
          {devices.length === 0 ? (
            <EmptyState
              icon={Smartphone}
              title="No devices yet"
              description="Switch on offline cash sales in Settings, then open the till on each device while it is online."
            />
          ) : (
            <ul className="divide-y">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{device.label}</span>
                      <span className="font-mono text-xs text-muted-foreground" title="Printed on this device's offline receipts">
                        OFF-{device.code}
                      </span>
                      <span className="text-sm text-muted-foreground">{device.kind}</span>
                      <Badge variant={STATE_BADGE[device.state].variant}>{STATE_BADGE[device.state].label}</Badge>
                      {device.openIssues > 0 && <Badge variant="warning">{device.openIssues} to review</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {device.branchName} · added by {device.registeredBy} {formatRelative(device.createdAt)} · last seen{' '}
                      {device.lastSeenAt ? formatRelative(device.lastSeenAt) : 'never'} · last offline upload{' '}
                      {device.lastSyncAt ? formatRelative(device.lastSyncAt) : 'none'} · {formatNumber(device.offlineSales, 0)} offline sale
                      {device.offlineSales === 1 ? '' : 's'}
                    </p>
                    {device.revoked && (
                      <p className="text-xs text-destructive-text">
                        Removed {formatDateTime(device.revoked.at)}
                        {device.revoked.by ? ` by ${device.revoked.by}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <DeviceAccessButton deviceId={device.id} label={`${device.label} ${device.code}`} revoked={device.revoked !== null} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
