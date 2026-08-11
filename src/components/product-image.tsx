'use client';

import * as React from 'react';
import { ImageOff, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The single way a product image is rendered anywhere in the application —
 * POS grid, product list, product detail, and the form preview.
 *
 * Deliberately a plain <img> rather than next/image. Product images can be
 * externally hosted on any domain a user pastes in, and next/image refuses any
 * host absent from `remotePatterns`, which would reject perfectly valid URLs at
 * runtime. Optimisation is not worth breaking user-supplied images over.
 *
 * Three states, never a broken-image icon:
 *   no image      -> package placeholder
 *   loading       -> neutral surface
 *   failed to load-> "Image unavailable"
 */

export type ProductImageSize = 'sm' | 'md' | 'lg' | 'fill';

const SIZES: Record<ProductImageSize, string> = {
  sm: 'h-9 w-9 rounded-md',
  md: 'h-14 w-14 rounded-md',
  lg: 'h-36 w-full rounded-md',
  fill: 'h-full w-full',
};

const ICON_SIZES: Record<ProductImageSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
  fill: 'h-7 w-7',
};

export function ProductImage({
  src,
  alt,
  size = 'md',
  className,
  /** Shows a short reason under the placeholder when the image fails. */
  showFailureText = false,
}: {
  src: string | null | undefined;
  alt: string;
  size?: ProductImageSize;
  className?: string;
  showFailureText?: boolean;
}) {
  const [status, setStatus] = React.useState<'idle' | 'loaded' | 'error'>('idle');

  // A changed src is a fresh attempt — otherwise a previous failure would stick
  // and a newly uploaded image would render as broken.
  React.useEffect(() => {
    setStatus('idle');
  }, [src]);

  const frame = cn(
    'relative flex shrink-0 items-center justify-center overflow-hidden border bg-muted',
    SIZES[size],
    className,
  );

  if (!src) {
    return (
      <div className={frame} role="img" aria-label={`${alt} — no image`}>
        <Package className={cn(ICON_SIZES[size], 'text-muted-foreground/50')} aria-hidden="true" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={frame} role="img" aria-label={`${alt} — image unavailable`}>
        <div className="flex flex-col items-center gap-1 px-2 text-center">
          <ImageOff className={cn(ICON_SIZES[size], 'text-muted-foreground/60')} aria-hidden="true" />
          {showFailureText && (
            <span className="text-[11px] leading-tight text-muted-foreground">Image unavailable</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={frame}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={cn(
          'h-full w-full object-contain transition-opacity',
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
      />
      {status === 'idle' && (
        <Package
          className={cn(ICON_SIZES[size], 'absolute text-muted-foreground/30')}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
