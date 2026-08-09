'use client';

import * as React from 'react';
import { Download, FileSpreadsheet, FileText, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const FORMATS = [
  { value: 'csv', label: 'CSV', icon: Table2, hint: 'Spreadsheet-friendly plain text' },
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet, hint: 'Formatted workbook with totals' },
  { value: 'pdf', label: 'PDF', icon: FileText, hint: 'Print-ready document' },
] as const;

/**
 * Report download control.
 *
 * Fetches the file rather than navigating so a server-side failure surfaces as
 * a toast instead of replacing the page with a raw JSON error.
 */
export function ExportMenu({ reportId, period }: { reportId: string; period?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const download = async (format: string) => {
    setBusy(format);

    try {
      const params = new URLSearchParams({ format });
      if (period) params.set('period', period);

      const response = await fetch(`/api/reports/${reportId}/export?${params.toString()}`);

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'The export failed.' }));
        toast.error(body.error ?? 'The export failed.');
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^"]+)"?/.exec(disposition);

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = match?.[1] ?? `${reportId}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast.success(`${format.toUpperCase()} downloaded.`);
    } catch {
      toast.error('The export could not be downloaded.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" loading={busy !== null}>
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {FORMATS.map((format) => (
          <DropdownMenuItem
            key={format.value}
            disabled={busy !== null}
            onSelect={(event) => {
              event.preventDefault();
              void download(format.value);
            }}
          >
            <format.icon />
            <span className="flex-1">
              <span className="block">{format.label}</span>
              <span className="block text-xs text-muted-foreground">{format.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
