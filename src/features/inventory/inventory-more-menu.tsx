'use client';

import Link from 'next/link';
import { ChevronDown, ClipboardEdit, History, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Advanced inventory tools, tucked away so the header stays to one clear action. */
export function InventoryMoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          More <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
