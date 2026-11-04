'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Loader2, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AUDIT_ACTION_LABEL, AUDIT_CATEGORY_LABEL, MASKED, type ChangeRow } from '@/lib/audit-log';
import { formatDateTime, humanizeEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getAuditEntryAction } from '@/features/audit/actions';
import { CategoryChip, SeverityBadge } from '@/features/audit/audit-visuals';
import type { StoreAuditEntry, StoreAuditRow } from '@/server/services/audit-queries';

/**
 * The activity list: a table on wide screens, stacked cards on tablets and phones.
 * Opening an entry loads its details from the server on demand, so a page of
 * the log never carries every entry's recorded details.
 */
export function AuditActivityList({ rows }: { rows: StoreAuditRow[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-[150px]">
                When
              </TableHead>
              <TableHead scope="col" className="w-[200px]">
                Activity
              </TableHead>
              <TableHead scope="col">What happened</TableHead>
              <TableHead scope="col" className="w-[170px]">
                By
              </TableHead>
              <TableHead scope="col" className="w-[120px]">
                Severity
              </TableHead>
              <TableHead scope="col" className="w-10">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn('cursor-pointer', row.severity === 'critical' && 'bg-destructive/[0.03]')}
                onClick={() => setOpenId(row.id)}
              >
                <TableCell className="whitespace-nowrap align-top text-xs tabular text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell className="align-top">
                  <CategoryChip category={row.category} />
                </TableCell>
                <TableCell className="align-top">
                  <p className="text-sm leading-snug">{row.summary}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{AUDIT_ACTION_LABEL[row.action]}</span>
                    {row.branchName && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden /> {row.branchName}
                      </span>
                    )}
                  </p>
                </TableCell>
                <TableCell className="align-top text-sm">
                  <Actor row={row} />
                </TableCell>
                <TableCell className="align-top">
                  <SeverityBadge severity={row.severity} />
                </TableCell>
                <TableCell className="align-top">
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Details: ${row.summary}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenId(row.id);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ol className="divide-y lg:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpenId(row.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <CategoryChip category={row.category} className="text-xs" />
                  {row.severity !== 'normal' && <SeverityBadge severity={row.severity} />}
                </div>
                <p className="text-sm leading-snug">{row.summary}</p>
                <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className="tabular">{formatDateTime(row.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{row.actorName ?? (row.action === 'LOGIN_FAILED' ? 'Unknown person' : 'System')}</span>
                  {row.branchName && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{row.branchName}</span>
                    </>
                  )}
                </p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ol>

      <AuditEntryDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function Actor({ row }: { row: Pick<StoreAuditRow, 'actorName' | 'actorUsername' | 'actorRole' | 'action'> }) {
  if (!row.actorName) {
    return <span className="text-muted-foreground">{row.action === 'LOGIN_FAILED' ? 'Unknown person' : 'System'}</span>;
  }
  return (
    <span className="block min-w-0">
      <span className="block truncate">{row.actorName}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {[row.actorUsername ? `@${row.actorUsername}` : null, row.actorRole].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

type DrawerState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; entry: StoreAuditEntry };

function AuditEntryDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [state, setState] = React.useState<DrawerState>({ status: 'idle' });

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ status: 'loading' });
    getAuditEntryAction(id).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', entry: result.data } : { status: 'error', message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          'left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-md translate-x-0 translate-y-0 content-start gap-5 rounded-none border-y-0 border-r-0 sm:rounded-l-card',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        )}
      >
        <DialogHeader>
          <DialogTitle>Activity details</DialogTitle>
          <DialogDescription>Read-only. Recorded when it happened and never edited.</DialogDescription>
        </DialogHeader>

        {state.status === 'loading' || state.status === 'idle' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : state.status === 'error' ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text">{state.message}</p>
        ) : (
          <EntryDetails entry={state.entry} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryDetails({ entry }: { entry: StoreAuditEntry }) {
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CategoryChip category={entry.category} />
          <SeverityBadge severity={entry.severity} />
        </div>
        <p className="text-base font-medium leading-snug">{entry.summary}</p>
      </div>

      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2.5 border-y py-4">
        <Term>When</Term>
        <Value className="tabular">{formatDateTime(entry.createdAt)}</Value>
        <Term>Activity</Term>
        <Value>
          {AUDIT_ACTION_LABEL[entry.action]} · {AUDIT_CATEGORY_LABEL[entry.category]}
        </Value>
        <Term>By</Term>
        <Value>
          <Actor row={entry} />
        </Value>
        <Term>Record</Term>
        <Value>
          {humanizeEnum(entry.entity)}
          {entry.entityId && <span className="block break-all text-xs text-muted-foreground">{entry.entityId}</span>}
        </Value>
        {entry.branchName && (
          <>
            <Term>Branch</Term>
            <Value>{entry.branchName}</Value>
          </>
        )}
        {entry.ipAddress && (
          <>
            <Term>IP address</Term>
            <Value className="tabular">{entry.ipAddress}</Value>
          </>
        )}
        {entry.device && (
          <>
            <Term>Device</Term>
            <Value>{entry.device}</Value>
          </>
        )}
      </dl>

      <section aria-labelledby="audit-recorded" className="space-y-2">
        <h3 id="audit-recorded" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recorded details
        </h3>
        {entry.details.length === 0 ? (
          <p className="text-muted-foreground">This entry recorded no further details.</p>
        ) : (
          <ChangeTable rows={entry.details} />
        )}
      </section>

      {entry.related && (
        <Link
          href={entry.related.href}
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          {entry.related.label} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function ChangeTable({ rows }: { rows: ChangeRow[] }) {
  const hasPairs = rows.some((row) => 'from' in row);
  return (
    <div className="overflow-x-auto rounded-md border scrollbar-thin">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Field
            </th>
            {hasPairs ? (
              <>
                <th scope="col" className="px-3 py-2 font-medium">
                  Before
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  After
                </th>
              </>
            ) : (
              <th scope="col" className="px-3 py-2 font-medium">
                Value
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.field} className="align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {humanizeField(row.field)}
              </th>
              {'from' in row ? (
                <>
                  <td className="px-3 py-2 text-muted-foreground">{show(row.from)}</td>
                  <td className="px-3 py-2">{show(row.to)}</td>
                </>
              ) : hasPairs ? (
                <td colSpan={2} className="px-3 py-2">
                  {show(row.value)}
                </td>
              ) : (
                <td className="px-3 py-2">{show(row.value)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function show(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">Empty</span>;
  if (value === MASKED) return <span className="text-muted-foreground">{MASKED}</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return <code className="break-all font-mono text-[11px]">{JSON.stringify(value)}</code>;
  return <span className="break-words">{String(value)}</span>;
}

/** "reviewStatus" → "Review status". */
function humanizeField(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt className="text-muted-foreground">{children}</dt>;
}

function Value({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dd className={cn('min-w-0', className)}>{children}</dd>;
}
