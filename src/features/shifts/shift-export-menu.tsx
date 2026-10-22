'use client';

import { useSearchParams } from 'next/navigation';
import { ChevronDown, Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const FILTER_KEYS = ['view', 'cashier', 'discrepancy', 'sort', 'q', 'period', 'from', 'to'] as const;

/** Downloads the shift list as it is filtered on screen, or prints the page. */
export function ShiftExportMenu() {
  const searchParams = useSearchParams();
  const href = (format: string) => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    params.set('format', format);
    return `/api/shifts/export?${params.toString()}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="no-print h-10">
          <Download /> Export <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={href('csv')}>CSV</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href('xlsx')}>Excel</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href('pdf')}>PDF</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.print()}>
          <Printer /> Print this page
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
