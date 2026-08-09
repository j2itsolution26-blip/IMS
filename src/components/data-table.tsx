'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Client-side sortable, filterable table.
 *
 * Used for reference data — categories, brands, users — where the whole set is
 * small enough to send at once. Large, growing tables (stock levels, sales,
 * the audit log) paginate on the server instead, because sending 40,000 rows to
 * sort them in the browser is not a real solution.
 */
export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = 'Search…',
  searchKeys,
  emptyState,
  pageSize = 15,
  toolbar,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string;
  /** Fields the search box matches against. Omit to disable search. */
  searchKeys?: (keyof TData)[];
  emptyState: React.ReactNode;
  pageSize?: number;
  toolbar?: React.ReactNode;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term || !searchKeys?.length) return data;

    return data.filter((row) =>
      searchKeys.some((key) => String(row[key] ?? '').toLowerCase().includes(term)),
    );
  }, [data, query, searchKeys]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();

  return (
    <div className="space-y-3">
      {(searchKeys?.length || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchKeys?.length ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
                aria-label={searchPlaceholder}
              />
            </div>
          ) : null}
          {toolbar}
        </div>
      )}

      <div className="rounded-lg border">
        {data.length === 0 ? (
          emptyState
        ) : (
          <>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sortable = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();

                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                          }
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ChevronsUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>

              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                      No rows match “{query}”.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Page {table.getState().pagination.pageIndex + 1} of {pageCount} · {filtered.length} rows
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    <ChevronLeft /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    Next <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Server-side pagination control for tables that page in the database. */
export function ServerPagination({
  page,
  pageCount,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) {
    return (
      <p className={cn('px-3 py-2 text-xs text-muted-foreground', className)}>
        {total} row{total === 1 ? '' : 's'}
      </p>
    );
  }

  return (
    <div className={cn('flex items-center justify-between gap-2 border-t px-3 py-2', className)}>
      <p className="text-xs text-muted-foreground">
        Page {page} of {pageCount} · {total} rows
      </p>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft /> Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
