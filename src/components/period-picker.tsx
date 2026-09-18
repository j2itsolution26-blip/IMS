'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PERIOD_OPTIONS, type PeriodKey } from '@/server/analytics/date-range';

/**
 * Period filter. Writes to the URL so the selection survives a refresh, is
 * shareable, and lets the server do the querying.
 *
 * `allowCustom` adds a custom range, which pages must opt into: it puts
 * `from`/`to` in the URL alongside `period=custom`, and a page that does not
 * read them would silently show the wrong window.
 */
export function PeriodPicker({
  current,
  paramName = 'period',
  allowCustom = false,
  customFrom,
  customTo,
}: {
  current: PeriodKey;
  paramName?: string;
  allowCustom?: boolean;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [showCustom, setShowCustom] = React.useState(current === 'custom');
  const [from, setFrom] = React.useState(customFrom ?? '');
  const [to, setTo] = React.useState(customTo ?? '');

  const go = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    // Changing the window invalidates any page cursor.
    params.delete('page');
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const onChange = (value: string) => {
    if (value === 'custom') {
      // Wait for two dates before reloading — a half-entered range is not a window.
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    go((params) => {
      params.set(paramName, value);
      params.delete('from');
      params.delete('to');
    });
  };

  const applyCustom = () => {
    if (!from || !to) return;
    go((params) => {
      params.set(paramName, 'custom');
      params.set('from', from);
      params.set('to', to);
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={showCustom ? 'custom' : current} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="w-[150px]" aria-label="Select reporting period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {allowCustom && <SelectItem value="custom">Custom range</SelectItem>}
        </SelectContent>
      </Select>

      {allowCustom && showCustom && (
        <>
          <div className="space-y-1">
            <Label htmlFor="period-from" className="text-xs font-normal text-muted-foreground">
              From
            </Label>
            <Input
              id="period-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="period-to" className="text-xs font-normal text-muted-foreground">
              To
            </Label>
            <Input
              id="period-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <Button type="button" onClick={applyCustom} disabled={!from || !to || pending} className="h-9">
            Apply
          </Button>
        </>
      )}
    </div>
  );
}
