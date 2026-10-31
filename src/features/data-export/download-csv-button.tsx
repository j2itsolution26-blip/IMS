'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DATA_EXPORT_ROW_LIMIT, type DataExportDataset } from '@/lib/data-export';

/**
 * "Download CSV" for the store's own products or sales, on every plan.
 * Fetches the file rather than navigating, so a refusal (permission, rate
 * limit, suspended store) shows as a toast instead of a raw JSON page.
 */
export function DownloadCsvButton({ dataset, label = 'Download CSV' }: { dataset: DataExportDataset; label?: string }) {
  const [busy, setBusy] = React.useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/data-export/${dataset}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'The download failed.' }));
        toast.error(body.error ?? 'The download failed.');
        return;
      }
      const blob = await response.blob();
      const match = /filename="?([^"]+)"?/.exec(response.headers.get('Content-Disposition') ?? '');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = match?.[1] ?? `${dataset}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      if (response.headers.get('X-Export-Truncated') === 'true') {
        toast.warning(`Downloaded the first ${DATA_EXPORT_ROW_LIMIT.toLocaleString('en-PH')} rows. Contact support if you need everything.`);
      } else {
        toast.success('CSV downloaded.');
      }
    } catch {
      toast.error('The CSV could not be downloaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="lg" className="no-print h-11" loading={busy} onClick={download}>
      <Download /> {label}
    </Button>
  );
}
