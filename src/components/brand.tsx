import Image from 'next/image';
import { APP_NAME, BRAND_LOGO, BRAND_MARK_SRC } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The full logo with its wordmark, for screens with room for it. Give it a
 * width class only: height follows the artwork's own proportions, so it is
 * never stretched or cropped.
 */
export function BrandLogo({ className, sizes, priority }: { className?: string; sizes: string; priority?: boolean }) {
  return (
    <Image
      src={BRAND_LOGO.src}
      width={BRAND_LOGO.width}
      height={BRAND_LOGO.height}
      alt={APP_NAME}
      sizes={sizes}
      priority={priority}
      className={cn('h-auto select-none object-contain', className)}
      draggable={false}
    />
  );
}

/**
 * The compact app icon (white cart and barcode on a green rounded square),
 * for the sidebar and header. Size it with height and width classes.
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
