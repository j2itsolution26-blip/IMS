'use client';

import { useSearchParams } from 'next/navigation';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const FILTER_KEYS = ['view', 'cashier', 'discrepancy', 'sort', 'q', 'period', 'from', 'to'] as const;

/**
 * Downloads the shift list as it is filtered on screen (a paid plan feature).
 * Printing is not here: it is ordinary browser printing, on every plan, from
 * the page's own Print button.
 */
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
