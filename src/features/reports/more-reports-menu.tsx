'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, FileBarChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface MoreReportLink {
  id: string;
  name: string;
  group: string;
  usesDateRange: boolean;
}

/**
 * The full report catalogue, one level down.
 *
 * Everything the owner rarely needs stays reachable here instead of competing
 * with the dashboard for attention on the main page.
 */
export function MoreReportsMenu({ reports, period }: { reports: MoreReportLink[]; period?: string }) {
  const groups = reports.reduce((map, report) => {
    const list = map.get(report.group) ?? [];
    list.push(report);
    map.set(report.group, list);
    return map;
  }, new Map<string, MoreReportLink[]>());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <FileBarChart /> More Reports <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {[...groups.entries()].map(([group, items], index) => (
          <React.Fragment key={group}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
              {group}
            </DropdownMenuLabel>
            {items.map((report) => (
              <DropdownMenuItem key={report.id} asChild>
                <Link
                  href={
                    period && report.usesDateRange
                      ? `/reports/${report.id}?period=${period}`
                      : `/reports/${report.id}`
                  }
                >
                  {report.name}
                </Link>
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
