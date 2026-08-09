'use client';

import * as React from 'react';
import type { ReportColumn, ReportRow } from '@/server/reports/registry';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatQuantity,
  humanizeEnum,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

/** Values that are enum-shaped are humanised so reports don't shout SCREAMING_SNAKE. */
const ENUM_LIKE = /^[A-Z][A-Z0-9_]+$/;

function renderCell(value: ReportRow[string], column: ReportColumn, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (column.format) {
    case 'currency':
      return formatCurrency(Number(value), currency);
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'quantity':
      return formatQuantity(Number(value));
    case 'number':
      return formatNumber(Number(value), 0);
    case 'date':
      return formatDate(value as Date);
    case 'datetime':
      return formatDateTime(value as Date);
    default: {
      const text = String(value);
      return ENUM_LIKE.test(text) ? humanizeEnum(text) : text;
    }
  }
}

/**
 * Report renderer.
 *
 * Paginates in the browser because a report is already a bounded result set —
 * the query that produced it applied the real limit. Totals are computed over
 * the whole result, not just the visible page, so the footer matches the export.
 */
export function ReportTable({
  columns,
  rows,
  currency,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  currency: string;
}) {
  const [page, setPage] = React.useState(0);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const totals = React.useMemo(() => {
    const result: Record<string, number> = {};
    for (const column of columns) {
      if (!column.total) continue;
      result[column.key] = rows.reduce((acc, row) => {
        const value = row[column.key];
        return acc + (typeof value === 'number' ? value : 0);
      }, 0);
    }
    return result;
  }, [columns, rows]);

  const hasTotals = Object.keys(totals).length > 0;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={cn(column.numeric && 'text-right')}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {visible.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(column.numeric && 'tabular text-right', 'max-w-[24rem] truncate')}
                >
                  {renderCell(row[column.key], column, currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>

        {hasTotals && (
          <TableFooter>
            <TableRow>
              {columns.map((column, index) => (
                <TableCell
                  key={column.key}
                  className={cn(column.numeric && 'tabular text-right', 'font-semibold')}
                >
                  {index === 0
                    ? 'Total'
                    : totals[column.key] !== undefined
                      ? renderCell(totals[column.key], column, currency)
                      : ''}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
          {pageCount > 1 ? ` · page ${page + 1} of ${pageCount}` : ''}
        </p>
        {pageCount > 1 && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
