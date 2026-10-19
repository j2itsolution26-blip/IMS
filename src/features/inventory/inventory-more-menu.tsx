'use client';

import Link from 'next/link';
import { ChevronDown, ClipboardEdit, Download, History, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Advanced inventory tools, tucked away so the header stays to one clear action.
 *
 * On a phone the header has no room for a separate Export button, so the
 * export link joins this menu there (and only there — desktop keeps its own
 * button). With no stock tools to offer, the trigger exists only for that.
 */
export function InventoryMoreMenu({
  showStockTools = true,
  exportHref,
  className,
}: {
  showStockTools?: boolean;
  exportHref?: string;
  className?: string;
}) {
  if (!showStockTools && !exportHref) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className={cn(!showStockTools && 'sm:hidden', className)}>
          More <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showStockTools && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/inventory/categories">
                <Tags /> Categories &amp; units
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/inventory/movements">
                <History /> Stock history
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/inventory/adjustments">
                <ClipboardEdit /> Correct stock
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {exportHref && (
          <DropdownMenuItem asChild className="sm:hidden">
            {/* A plain anchor: this returns a file, and client-side routing
                has no idea what to do with a Content-Disposition. */}
            <a href={exportHref}>
              <Download /> Export stock (CSV)
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
