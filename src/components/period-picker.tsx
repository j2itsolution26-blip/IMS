'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PERIOD_OPTIONS, type PeriodKey } from '@/server/analytics/date-range';

/**
 * Period filter. Writes to the URL so the selection survives a refresh, is
 * shareable, and lets the server do the querying.
 */
export function PeriodPicker({ current, paramName = 'period' }: { current: PeriodKey; paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, value);
    // Changing the window invalidates any page cursor.
    params.delete('page');
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <Select value={current} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-[150px]" aria-label="Select reporting period">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
