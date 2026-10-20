'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Quantity stepper for a cart line: − / typed amount / +.
 *
 * The typed text is kept as a draft, so clearing the box to type "5" doesn't
 * read as zero and drop the item. Only a valid amount above zero is passed
 * on as it's typed; anything else snaps back to the line's quantity when the
 * field is left. Everything is sold by the piece, so only whole numbers of
 * at least 1 are accepted. Enter leaves
 * the field, which is also how a cashier gets back to scanning.
 */
export function QuantityInput({
  value,
  onChange,
  label,
  size = 'default',
  onFocusChange,
  className,
}: {
  value: number;
  onChange: (quantity: number) => void;
  /** Accessible name, e.g. "Quantity for Piattos". */
  label: string;
  size?: 'default' | 'lg';
  onFocusChange?: (focused: boolean) => void;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);

  // Follow the real quantity whenever the cashier isn't mid-edit — a scan or
  // a stock clamp changes it from outside.
  React.useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  // A line removed while its field has focus never blurs — say so on the way
  // out, or whoever is waiting for the edit to end (the scanner) waits forever.
  const focusChange = React.useRef(onFocusChange);
  React.useEffect(() => {
    focusChange.current = onFocusChange;
  });
  const focusedRef = React.useRef(false);
  React.useEffect(
    () => () => {
      if (focusedRef.current) focusChange.current?.(false);
    },
    [],
  );

  const parse = (text: string): number | null => {
    if (!text.trim()) return null;
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < 1) return null;
    return n;
  };

  const big = size === 'lg';
  const button = big ? 'h-12 w-12' : 'h-10 w-10';

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(button, 'shrink-0')}
        // Stops at one: taking an item off is the remove button's job, never
        // a stray tap.
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, Math.round(value) - 1))}
        aria-label={`One fewer — ${label}`}
      >
        <Minus />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        value={draft}
        onChange={(event) => {
          const text = event.target.value.replace(/[^0-9]/g, '');
          setDraft(text);
          const n = parse(text);
          if (n !== null) onChange(n);
        }}
        onFocus={(event) => {
          setFocused(true);
          focusedRef.current = true;
          onFocusChange?.(true);
          event.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          focusedRef.current = false;
          onFocusChange?.(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={cn('tabular text-center font-semibold', big ? 'h-12 w-20 text-lg' : 'h-10 w-16')}
        aria-label={label}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(button, 'shrink-0')}
        onClick={() => onChange(Math.round(value) + 1)}
        aria-label={`One more — ${label}`}
      >
        <Plus />
      </Button>
    </div>
  );
}
