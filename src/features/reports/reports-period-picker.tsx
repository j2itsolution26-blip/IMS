'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom Date' },
];

/**
 * Date filter for the Reports dashboard: four presets plus a custom range.
 *
 * The selection lives in the URL so the server does the querying, a refresh
 * keeps the window, and the export can be handed the same dates.
 */
export function ReportsPeriodPicker({
  period,
  from,
  to,
  label,
}: {
  period: string;
  /** Resolved window start/end as yyyy-MM-dd — seeds the custom inputs. */
  from: string;
  to: string;
  /** Shown in the trigger when the period is not one of the five options. */
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [start, setStart] = React.useState(from);
  const [end, setEnd] = React.useState(to);

  // Re-seed whenever the server resolves a different window (preset change,
  // back button) so the inputs never disagree with what is on screen.
  React.useEffect(() => {
    setStart(from);
    setEnd(to);
  }, [from, to]);

  const push = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  const onSelect = (value: string) =>
    push((params) => {
      params.set('period', value);
      if (value === 'custom') {
        // Seeded with the window already on screen, so picking "Custom Date"
        // changes nothing until the owner actually chooses their own dates.
        params.set('from', start);
        params.set('to', end);
      } else {
        params.delete('from');
        params.delete('to');
      }
    });

  const isCustom = period === 'custom';
  const edited = start !== from || end !== to;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={period} onValueChange={onSelect} disabled={pending}>
        <SelectTrigger className="w-[150px]" aria-label="Select date range">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isCustom && (
        <>
          <Input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className="w-[160px]"
            aria-label="From date"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className="w-[160px]"
            aria-label="To date"
          />
          <Button
            variant="outline"
            disabled={pending || !start || !end || !edited}
            onClick={() =>
              push((params) => {
                params.set('period', 'custom');
                params.set('from', start);
                params.set('to', end);
              })
            }
          >
            Apply
          </Button>
        </>
      )}
    </div>
  );
}
