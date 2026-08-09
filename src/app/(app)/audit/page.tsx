import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import type { AuditAction, Prisma } from '@prisma/client';
import { requirePermission } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatDateTime, humanizeEnum } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const ACTIONS: AuditAction[] = [
  'LOGIN',
  'LOGOUT',
  'CREATE',
  'UPDATE',
  'DELETE',
  'INVENTORY_CHANGE',
  'PRICE_CHANGE',
  'SALE',
  'PURCHASE',
  'RETURN',
  'SETTINGS_CHANGE',
  'EXPORT',
];

const ACTION_VARIANT: Partial<Record<AuditAction, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'>> = {
  CREATE: 'success',
  UPDATE: 'default',
  DELETE: 'destructive',
  INVENTORY_CHANGE: 'warning',
  PRICE_CHANGE: 'warning',
  SETTINGS_CHANGE: 'warning',
  LOGIN: 'secondary',
  LOGOUT: 'secondary',
};

/** Renders the stored before/after diff without dumping raw JSON at the user. */
function ChangeSummary({ changes }: { changes: Prisma.JsonValue | null }) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;

  const entries = Object.entries(changes as Record<string, unknown>).slice(0, 4);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5">
      {entries.map(([field, value]) => {
        const change = value as { from?: unknown; to?: unknown };
        if (change?.from === undefined && change?.to === undefined) return null;
        return (
          <li key={field} className="text-xs text-muted-foreground">
            <span className="font-medium">{field}</span>: {String(change.from ?? '—')} →{' '}
            <span className="text-foreground">{String(change.to ?? '—')}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; user?: string; period?: string; page?: string }>;
}) {
  await requirePermission('audit.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'last30');
  const range = resolveRange(period);
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 50;

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: range.from, lte: range.to },
    ...(ACTIONS.includes(params.action as AuditAction) ? { action: params.action as AuditAction } : {}),
    ...(params.user ? { userId: params.user } : {}),
    ...(params.q?.trim()
      ? {
          OR: [
            { summary: { contains: params.q.trim(), mode: 'insensitive' } },
            { entity: { contains: params.q.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [logs, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, record change, stock movement, price change, and setting update, with who did it and when."
        actions={<PeriodPicker current={period} />}
      />

      <FilterBar
        searchPlaceholder="Search the log…"
        selects={[
          {
            name: 'action',
            label: 'Action',
            allLabel: 'All actions',
            width: 'w-[180px]',
            options: ACTIONS.map((action) => ({ value: action, label: humanizeEnum(action) })),
          },
          {
            name: 'user',
            label: 'User',
            allLabel: 'All users',
            options: users.map((user) => ({ value: user.id, label: user.name })),
          },
        ]}
      />

      <div className="rounded-lg border">
        {logs.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing logged in this period"
            description="The audit trail records changes as they happen. Widen the period or clear the filters to see more."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead className="hidden md:table-cell">Who</TableHead>
                  <TableHead className="hidden lg:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[log.action] ?? 'secondary'}>
                        {humanizeEnum(log.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{log.summary}</p>
                      <p className="text-xs text-muted-foreground">{log.entity}</p>
                      <ChangeSummary changes={log.changes} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {log.user?.name ?? 'System'}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                      {log.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar page={page} pageCount={pageCount} total={total} />
          </>
        )}
      </div>
    </>
  );
}
