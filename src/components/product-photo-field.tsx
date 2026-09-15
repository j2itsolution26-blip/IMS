'use client';

import * as React from 'react';
import { AlertTriangle, Camera, Check, ImageIcon, Loader2, Package, Trash2 } from 'lucide-react';
import { uploadProductImageAction } from '@/features/products/actions';
import { ProductImage } from '@/components/product-image';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;
/** Below this an already-supported photo is left alone rather than re-encoded. */
const RECOMPRESS_OVER_BYTES = 600 * 1024;

const STORAGE_FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PhotoUploadStatus = 'idle' | 'preparing' | 'uploading' | 'uploaded' | 'failed';

/** A decoded frame, however the browser was willing to decode it. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
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

/**
 * Makes a camera photo fit for upload: HEIC and anything else exotic becomes
 * JPEG, and an 8 MP phone shot is scaled down to something a product
 * thumbnail actually needs. A photo that is already small and in a supported
 * format is passed through untouched.
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('This photo could not be processed.');

  // Re-encoding a small supported file can make it bigger; keep whichever is
  // smaller, as long as storage will accept it.
  if (STORAGE_FORMATS.has(file.type) && blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/**
 * Product photo capture and upload, shared by the quick Add Product dialog and
 * the full product form.
 *
 * Two taps from nothing to a stored photo: "Add Photo", then camera or
 * gallery. The preview appears immediately, but the product only carries an
 * image once storage has actually accepted it — a preview is not evidence of
 * an upload. A failure keeps the chosen photo in hand so "Try again" is one
 * tap, and never touches the rest of the form.
 */
export function ProductPhotoField({
  value,
  onChange,
  onStatusChange,
  fileNameHint,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  onStatusChange?: (status: PhotoUploadStatus) => void;
  fileNameHint: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = React.useState<PhotoUploadStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [choosing, setChoosing] = React.useState(false);
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  // Held so a failed upload can be retried without asking for the photo again.
  const pendingFile = React.useRef<File | null>(null);
  const previewRef = React.useRef<string | null>(null);
  const hintRef = React.useRef(fileNameHint);
  hintRef.current = fileNameHint;

  React.useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const setPreviewUrl = React.useCallback((url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }, []);

  // Object URLs outlive the component unless released explicitly.
  React.useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const upload = React.useCallback(
    async (file: File) => {
      setError(null);

      let prepared: File;
      try {
        setStatus('preparing');
        prepared = await prepareForUpload(file);
      } catch (caught) {
        setStatus('failed');
        setError(
          caught instanceof Error && caught.message
            ? `${caught.message} Try taking it again, or choose a different photo.`
            : 'This photo could not be read. Choose a different one.',
        );
        return;
      }

      // A phone that is offline will not reach storage; say so directly rather
      // than after a timeout.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('failed');
        setError('Photo upload failed because the connection was interrupted.');
        return;
      }

      setStatus('uploading');

      const formData = new FormData();
      formData.append('file', prepared);
      formData.append('sku', hintRef.current || 'product');

      try {
        const result = await uploadProductImageAction(formData);

        if (!result.ok) {
          setStatus('failed');
          setError(result.error);
          return;
        }

        onChange(result.data.url);
        setStatus('uploaded');
      } catch {
        // The request itself never completed — a dropped mobile connection, or
        // the server going away mid-upload.
        setStatus('failed');
        setError(
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'Photo upload failed because the connection was interrupted.'
            : "Couldn't upload the product photo. Check your connection and try again.",
        );
      }
    },
    [onChange],
  );

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;

    setChoosing(false);
    pendingFile.current = file;
    setPreviewUrl(URL.createObjectURL(file));
    onChange('');
    await upload(file);
  };

  const remove = () => {
    pendingFile.current = null;
    setPreviewUrl(null);
    setError(null);
    setStatus('idle');
    onChange('');
    setConfirmingRemove(false);
  };

  const busy = status === 'preparing' || status === 'uploading';
  const shown = preview ?? (value || null);

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
      {shown ? (
        <div className="relative">
          <ProductImage src={shown} alt="Product photo" size="lg" className="h-44" />

          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-md bg-background/70">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium">
                {status === 'preparing' ? 'Preparing photo…' : 'Uploading photo…'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-10 text-center">
          <Package className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No photo yet</p>
        </div>
      )}

      {status === 'uploaded' && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Photo uploaded
        </p>
      )}

      {status === 'failed' && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
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
              onClick={() => pendingFile.current && upload(pendingFile.current)}
              disabled={!pendingFile.current}
            >
              Try Again
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setChoosing(true)}>
              Choose Another Photo
            </Button>
          </div>
        </div>
      )}

      {!busy && status !== 'failed' && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setChoosing(true)}>
            <Camera /> {shown ? 'Change Photo' : 'Add Photo'}
          </Button>
          {shown && (
            <Button type="button" variant="outline" onClick={() => setConfirmingRemove(true)}>
              <Trash2 /> Remove
            </Button>
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
              <ImageIcon /> Choose From Gallery
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setChoosing(false)}
            >
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
