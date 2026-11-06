'use client';

import { cn } from '@/lib/utils';
import type { ProductUnit } from '@/lib/quantity';
import { presetLabel, presetsFor, type PresetProduct } from '@/lib/quantity-presets';

/**
 * One-tap quantities for a cart line: ¼ kg, ½ kg, 1½ kg, 250 g, 2.5 m … The
 * buttons only set the line's quantity, in the product's own unit; the
 * server prices it from the database and checks the stock again. The current
 * quantity is marked, so the cashier sees what is selected at a glance.
 */
export function QuantityPresets({
  product,
  value,
  onSelect,
  label,
  size = 'default',
  className,
}: {
  product: PresetProduct & { unit: ProductUnit };
  value: number;
  onSelect: (quantity: number) => void;
  /** Accessible name of the group, e.g. "Quick quantities for Rice". */
  label: string;
  size?: 'default' | 'lg';
  className?: string;
}) {
  const presets = presetsFor(product);
  if (presets.length === 0) return null;
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {presets.map((preset) => {
        const selected = Math.abs(preset - value) < 0.0005;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(preset)}
            className={cn(
              'rounded-lg border px-2.5 text-sm font-semibold tabular transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              size === 'lg' ? 'h-11 min-w-[3.75rem]' : 'h-9 min-w-[3.25rem]',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50 hover:bg-primary/5',
            )}
          >
            {presetLabel(preset, product.unit)}
          </button>
        );
      })}
    </div>
  );
}
