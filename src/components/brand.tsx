import { APP_NAME, BRAND_MARK_SRC } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The official app icon (white cart in a green rounded square). Size it with
 * height and width classes; it is square and never stretched.
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    // A small static SVG gains nothing from the image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_MARK_SRC}
      width={40}
      height={40}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0 select-none object-contain', className)}
      draggable={false}
    />
  );
}

/**
 * The icon beside the product name: the brand lockup for entry screens.
 * `tone="light"` is for dark backgrounds.
 */
export function BrandLockup({
  size = 'md',
  tone = 'default',
  className,
}: {
  size?: 'md' | 'lg';
  tone?: 'default' | 'light';
  className?: string;
}) {
  const [product, ...rest] = APP_NAME.split(' ');
  return (
    <div className={cn('flex items-center', size === 'lg' ? 'gap-4' : 'gap-3', className)}>
      <BrandMark className={cn(size === 'lg' ? 'h-16 w-16 rounded-2xl' : 'h-12 w-12 rounded-xl', 'shadow-md')} />
      <div className="min-w-0 leading-tight">
        <p className={cn('font-bold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-xl', tone === 'light' ? 'text-white' : 'text-foreground')}>
          {product}
        </p>
        <p
          className={cn(
            'font-semibold uppercase tracking-[0.18em]',
            size === 'lg' ? 'text-xs' : 'text-[11px]',
            tone === 'light' ? 'text-emerald-200/80' : 'text-primary',
          )}
        >
          {rest.join(' ')}
        </p>
      </div>
    </div>
  );
}
