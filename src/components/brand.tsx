import Image from 'next/image';
import { APP_NAME, BRAND_LOGO, BRAND_MARK_SRC } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * The official logo. Give it a width class only — height follows from the
 * intrinsic aspect ratio, so the artwork is never stretched or cropped.
 */
export function BrandLogo({
  className,
  sizes,
  priority,
}: {
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={BRAND_LOGO.src}
      width={BRAND_LOGO.width}
      height={BRAND_LOGO.height}
      alt={APP_NAME}
      sizes={sizes}
      priority={priority}
      className={cn('h-auto select-none', className)}
      draggable={false}
    />
  );
}

/** The square app mark used where the full logo would be illegible. */
export function BrandMark({ className }: { className?: string }) {
  return (
    // A tiny static SVG gains nothing from the image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_MARK_SRC}
      width={40}
      height={40}
      alt=""
      aria-hidden="true"
      className={cn('shrink-0 select-none', className)}
      draggable={false}
    />
  );
}
