'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Export hands off to the existing report pages rather than growing a second
 * export path: those already render the same figures and carry CSV, Excel and
 * PDF between them. The selected window travels with the link so the report
 * opens on the period the owner was looking at.
 */
const REPORTS = [
  { id: 'sales-summary', label: 'Sales summary' },
  { id: 'sales-detail', label: 'Transactions' },
  { id: 'best-selling', label: 'Product sales' },
  { id: 'sales-by-category', label: 'Sales by category' },
  { id: 'sales-by-payment-method', label: 'Sales by payment method' },
];

export function ExportMenu() {
  const searchParams = useSearchParams();

  const window = new URLSearchParams();
  for (const key of ['period', 'from', 'to'] as const) {
    const value = searchParams.get(key);
    if (value) window.set(key, value);
  }
  const suffix = window.toString() ? `?${window.toString()}` : '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="h-11">
          <Download /> Export <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {REPORTS.map((report) => (
          <DropdownMenuItem key={report.id} asChild>
            <Link href={`/reports/${report.id}${suffix}`}>{report.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
