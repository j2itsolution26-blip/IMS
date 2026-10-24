'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  ImageIcon,
  Loader2,
  Package,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { removeProductBackgroundAction, uploadProductImageAction } from '@/features/products/actions';
import { LockedButton, type UpgradeInfo } from '@/features/subscription/upgrade-dialog';
import { ProductImage } from '@/components/product-image';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { alphaBounds, squarePlacement } from '@/lib/image-layout';
import { cn } from '@/lib/utils';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;
/** Below this an already-supported photo is left alone rather than re-encoded. */
const RECOMPRESS_OVER_BYTES = 600 * 1024;
/** Side of the square canvas a cut-out is centred on. */
const CUTOUT_MAX_SIDE = 1024;
const CUTOUT_PADDING = 0.08;

const STORAGE_FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * `reviewing` — a new photo is chosen but not yet saved: the user is deciding
 * between the original and the background-removed version. The product form
 * treats it like an upload in progress, so it cannot be saved without one.
 */
export type PhotoUploadStatus = 'idle' | 'preparing' | 'reviewing' | 'uploading' | 'uploaded' | 'failed';

type Stage = 'idle' | 'preparing' | 'review' | 'removing' | 'uploading' | 'uploaded' | 'failed';

interface Shot {
  file: File;
  url: string;
}

const STATUS_BY_STAGE: Record<Stage, PhotoUploadStatus> = {
  idle: 'idle',
  preparing: 'preparing',
  review: 'reviewing',
  removing: 'reviewing',
  uploading: 'uploading',
  uploaded: 'uploaded',
  failed: 'failed',
};

/** A decoded frame, however the browser was willing to decode it. */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Safari decodes HEIC natively through <img> even where createImageBitmap
    // refuses, so this is a real second chance rather than a formality.
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('This photo could not be read.'));
      };
      image.src = url;
    });
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Makes a camera photo fit for upload: HEIC and anything else exotic becomes
 * JPEG, and an 8 MP phone shot is scaled down to something a product
 * thumbnail actually needs. A photo that is already small and in a supported
 * format is passed through untouched.
 *
 * Only ever applied to an original photo — a cut-out must keep its alpha
 * channel, which JPEG would flatten.
 */
async function prepareForUpload(file: File): Promise<File> {
  const alreadyUsable = STORAGE_FORMATS.has(file.type) && file.size <= RECOMPRESS_OVER_BYTES;
  if (alreadyUsable) return file;

  const source = await decode(file);
  const width = 'width' in source ? source.width : 0;
  const height = 'height' in source ? source.height : 0;
  if (!width || !height) throw new Error('This photo could not be read.');

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This photo could not be processed.');

  // JPEG has no alpha channel — an unfilled canvas would turn a transparent
  // PNG's background solid black once flattened.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  const blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  if (!blob) throw new Error('This photo could not be processed.');

  // Re-encoding a small supported file can make it bigger; keep whichever is
  // smaller, as long as storage will accept it.
  if (STORAGE_FORMATS.has(file.type) && blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/**
 * Centres a background-removed product on a square transparent canvas.
 *
 * The visible pixels are found first, so the product is framed by its own
 * outline rather than by wherever it sat in the photo — never cropped, never
 * stretched. Saved as WebP with alpha where the browser can encode it, PNG
 * otherwise; both keep the transparency.
 */
async function frameCutout(cutout: Blob, name: string): Promise<File> {
  const source = await decode(cutout);
  const width = source.width;
  const height = source.height;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
  if (!scratchContext) throw new Error('The processed photo could not be prepared.');
  scratchContext.drawImage(source, 0, 0);
  if ('close' in source) source.close();

  const bounds = alphaBounds(scratchContext.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) throw new Error('No product was left after removing the background.');

  const placement = squarePlacement(bounds, { maxSide: CUTOUT_MAX_SIDE, padding: CUTOUT_PADDING });
  const canvas = document.createElement('canvas');
  canvas.width = placement.side;
  canvas.height = placement.side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The processed photo could not be prepared.');

  context.imageSmoothingQuality = 'high';
  context.drawImage(
    scratch,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    placement.dx,
    placement.dy,
    placement.dw,
    placement.dh,
  );

  // Browsers that cannot encode WebP quietly hand back PNG instead, so the
  // blob's own type decides the extension.
  const blob = (await toBlob(canvas, 'image/webp', 0.9)) ?? (await toBlob(canvas, 'image/png'));
  if (!blob) throw new Error('The processed photo could not be prepared.');

  const type = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
  return new File([blob], `${name.replace(/\.[^.]+$/, '')}-cutout.${type === 'image/webp' ? 'webp' : 'png'}`, {
    type,
  });
}

/** Transparent areas read as transparent, in light and dark themes alike. */
const CHECKERBOARD =
  'bg-[image:conic-gradient(hsl(var(--muted))_25%,hsl(var(--card))_0_50%,hsl(var(--muted))_0_75%,hsl(var(--card))_0)] bg-[length:16px_16px]';

/**
 * Product photo capture and upload, shared by the quick Add Product dialog and
 * the full product form.
 *
 * Take Photo opens the rear camera on a phone; Choose From Gallery picks a
 * file. When background removal is configured, a new photo waits for review:
 * Remove Background sends it to the server, the result is shown on a
 * checkerboard beside the original, and only the version the user picks —
 * Save Image or Use Original — is uploaded. Without it, a photo uploads
 * straight away as before.
 *
 * The product's existing image is untouched until a new one has actually been
 * stored: a preview is not evidence of an upload, and a failed or cancelled
 * attempt leaves the saved photo in place.
 */
export function ProductPhotoField({
  value,
  onChange,
  onStatusChange,
  fileNameHint,
  disabled,
  backgroundRemovalEnabled = false,
  backgroundRemovalLock = null,
}: {
  value: string;
  onChange: (url: string) => void;
  onStatusChange?: (status: PhotoUploadStatus) => void;
  fileNameHint: string;
  disabled?: boolean;
  backgroundRemovalEnabled?: boolean;
  /** Set when the store's plan has no background removal: the feature is shown locked. */
  backgroundRemovalLock?: UpgradeInfo | null;
}) {
  const [stage, setStage] = React.useState<Stage>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const [original, setOriginal] = React.useState<Shot | null>(null);
  const [processed, setProcessed] = React.useState<Shot | null>(null);
  const [showing, setShowing] = React.useState<'original' | 'processed'>('original');
  /** Local copy of what was last uploaded, so the saved photo shows without a reload flash. */
  const [savedPreview, setSavedPreview] = React.useState<string | null>(null);
  const [choosing, setChoosing] = React.useState(false);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  // Held so a failed upload can be retried without asking for the photo again.
  const pendingUpload = React.useRef<File | null>(null);
  const objectUrls = React.useRef(new Set<string>());
  const hintRef = React.useRef(fileNameHint);
  hintRef.current = fileNameHint;

  React.useEffect(() => {
    onStatusChange?.(STATUS_BY_STAGE[stage]);
  }, [stage, onStatusChange]);

  const makeUrl = React.useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    return url;
  }, []);

  const releaseUrl = React.useCallback((url: string | null | undefined) => {
    if (url && objectUrls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);

  // Object URLs outlive the component unless released explicitly.
  React.useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const discardWorking = React.useCallback(() => {
    setOriginal((shot) => {
      releaseUrl(shot?.url);
      return null;
    });
    setProcessed((shot) => {
      releaseUrl(shot?.url);
      return null;
    });
    setShowing('original');
    setRemoveError(null);
  }, [releaseUrl]);

  const upload = React.useCallback(
    async (file: File, previewUrl: string) => {
      setError(null);

      // A phone that is offline will not reach storage; say so directly rather
      // than after a timeout.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        pendingUpload.current = file;
        setStage('failed');
        setError('Photo upload failed because the connection was interrupted.');
        return;
      }

      setStage('uploading');
      pendingUpload.current = file;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('sku', hintRef.current || 'product');

      try {
        const result = await uploadProductImageAction(formData);

        if (!result.ok) {
          setStage('failed');
          setError(result.error);
          return;
        }

        // Keep a private copy of the saved preview; the review shots are done.
        const kept = makeUrl(file);
        setSavedPreview((previous) => {
          releaseUrl(previous);
          return kept;
        });
        releaseUrl(previewUrl);
        discardWorking();
        pendingUpload.current = null;

        onChange(result.data.url);
        setStage('uploaded');
      } catch {
        // The request itself never completed — a dropped mobile connection, or
        // the server going away mid-upload.
        setStage('failed');
        setError(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'Photo upload failed because the connection was interrupted.'
            : "Couldn't upload the product photo. Check your connection and try again.",
        );
      }
    },
    [onChange, makeUrl, releaseUrl, discardWorking],
  );

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;

    setChoosing(false);
    discardWorking();
    setError(null);
    setStage('preparing');

    let prepared: File;
    try {
      prepared = await prepareForUpload(file);
    } catch (caught) {
      setStage('failed');
      pendingUpload.current = null;
      setError(
        caught instanceof Error && caught.message
          ? `${caught.message} Try taking it again, or choose a different photo.`
          : 'This photo could not be read. Choose a different one.',
      );
      return;
    }

    const shot = { file: prepared, url: makeUrl(prepared) };
    setOriginal(shot);

    if (backgroundRemovalEnabled) {
      setStage('review');
    } else {
      await upload(shot.file, shot.url);
    }
  };

  const removeBackground = async () => {
    if (!original) return;
    setRemoveError(null);
    setStage('removing');

    const formData = new FormData();
    formData.append('file', original.file);

    try {
      const result = await removeProductBackgroundAction(formData);
      if (!result.ok) {
        setRemoveError(result.error);
        setStage('review');
        return;
      }

      const cutout = await (await fetch(result.data.dataUrl)).blob();
      const framed = await frameCutout(cutout, original.file.name);

      setProcessed((previous) => {
        releaseUrl(previous?.url);
        return { file: framed, url: makeUrl(framed) };
      });
      setShowing('processed');
    } catch (caught) {
      setRemoveError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'The background could not be removed. Try again, or use the original photo.',
      );
    }
    setStage('review');
  };

  const cancelReview = () => {
    discardWorking();
    setError(null);
    setStage(value ? 'uploaded' : 'idle');
  };

  const remove = () => {
    pendingUpload.current = null;
    discardWorking();
    setSavedPreview((previous) => {
      releaseUrl(previous);
      return null;
    });
    setError(null);
    setStage('idle');
    onChange('');
    setConfirmingRemove(false);
  };

  const reviewing = stage === 'review' || stage === 'removing';
  const busy = stage === 'preparing' || stage === 'removing' || stage === 'uploading';
  const working = original !== null;
  const displayProcessed = working && processed !== null && showing === 'processed';
  const shown = working
    ? displayProcessed
      ? processed!.url
      : original!.url
    : (savedPreview ?? (value || null));

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center">
        <Package className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium">Photos are unavailable right now</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You can still save the product and add a photo later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {working && processed && (
        <div role="tablist" aria-label="Compare photos" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-xs font-medium">
          {(['original', 'processed'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={showing === option}
              onClick={() => setShowing(option)}
              className={cn(
                'rounded-full px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                showing === option ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'original' ? 'Original' : 'Background removed'}
            </button>
          ))}
        </div>
      )}

      {shown ? (
        <div className={cn('relative overflow-hidden rounded-md', displayProcessed && CHECKERBOARD)}>
          <ProductImage
            src={shown}
            alt={displayProcessed ? 'Product photo with background removed' : 'Product photo'}
            size="lg"
            className={cn('h-44', displayProcessed && 'bg-transparent')}
          />

          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-md bg-background/70">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium" aria-live="polite">
                {stage === 'preparing'
                  ? 'Preparing photo…'
                  : stage === 'removing'
                    ? 'Removing background…'
                    : 'Uploading photo…'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-10 text-center">
          {busy ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60" aria-hidden="true" />
          ) : (
            <Package className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          )}
          <p className="text-sm font-medium text-muted-foreground">
            {stage === 'preparing' ? 'Preparing photo…' : 'No photo yet'}
          </p>
        </div>
      )}

      {stage === 'uploaded' && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success-text">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Photo uploaded
        </p>
      )}

      {reviewing && removeError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-destructive-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Couldn&apos;t remove the background.
              <span className="mt-1 block font-normal opacity-90">{removeError}</span>
            </span>
          </p>
        </div>
      )}

      {reviewing && original && (
        <div className="space-y-2">
          {processed ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button
                type="button"
                className="col-span-2 sm:col-span-1"
                disabled={busy}
                onClick={() => upload(processed.file, processed.url)}
              >
                <Check /> Save Image
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => upload(original.file, original.url)}>
                Use Original
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={removeBackground}>
                <RotateCcw /> Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" disabled={busy} onClick={removeBackground}>
                {removeError ? <RotateCcw /> : <Sparkles />} {removeError ? 'Retry' : 'Remove Background'}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => upload(original.file, original.url)}>
                Use Original
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" className="w-full" disabled={busy} onClick={cancelReview}>
            <X /> {value ? 'Keep current photo' : 'Discard photo'}
          </Button>
        </div>
      )}

      {stage === 'failed' && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-destructive-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Couldn&apos;t upload the product photo.
              {error ? <span className="mt-1 block font-normal opacity-90">{error}</span> : null}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const file = pendingUpload.current;
                if (file) upload(file, '');
              }}
              disabled={!pendingUpload.current}
            >
              Try Again
            </Button>
            {working && backgroundRemovalEnabled && (
              <Button type="button" size="sm" variant="outline" onClick={() => setStage('review')}>
                Back to Photo
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setChoosing(true)}>
              Choose Another Photo
            </Button>
          </div>
        </div>
      )}

      {!busy && !reviewing && stage !== 'failed' && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setChoosing(true)}>
            <Camera /> {shown ? 'Change Photo' : 'Add Photo'}
          </Button>
          {shown && (
            <Button type="button" variant="outline" onClick={() => setConfirmingRemove(true)}>
              <Trash2 /> Remove
            </Button>
          )}
          {backgroundRemovalLock && (
            <LockedButton
              label="Remove backgrounds"
              icon={<Sparkles />}
              info={backgroundRemovalLock}
              variant="ghost"
              size="sm"
              className="w-full"
            />
          )}
        </div>
      )}

      {/* Two inputs rather than one: `capture` is what opens the camera
          directly on a phone, and its absence is what opens the gallery. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add Product Photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              type="button"
              size="lg"
              className="w-full justify-start"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera /> Take Photo
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full justify-start"
              onClick={() => galleryInputRef.current?.click()}
            >
              <ImageIcon /> Upload Image
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setChoosing(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title="Remove this product photo?"
        description="The product will show a placeholder icon until another photo is added."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}
