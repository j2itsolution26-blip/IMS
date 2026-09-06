'use client';

import * as React from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadProductImageAction } from '@/features/products/actions';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.82;

/**
 * Downscales and re-compresses a photo in the browser before it ever reaches
 * the network — a phone camera shot easily runs 4000px/8MB, far more than a
 * small product thumbnail needs. Falls back to the original file untouched
 * if the browser can't decode it (e.g. HEIC with no built-in decoder); the
 * server's format/size checks still apply either way.
 */
async function optimizeImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }

  // JPEG has no alpha channel — an unfilled canvas would turn a transparent
  // PNG's background solid black once flattened.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

/**
 * The Product Photo field for the quick Add Product dialog. Optional, no
 * cropping/editing — take or pick a picture, see the preview, done.
 */
export function ProductPhotoField({
  value,
  onChange,
  fileNameHint,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  fileNameHint: string;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    const optimized = await optimizeImage(file);
    const formData = new FormData();
    formData.append('file', optimized);
    formData.append('sku', fileNameHint || 'product');

    const result = await uploadProductImageAction(formData);
    setUploading(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onChange(result.data.url);
  };

  if (disabled) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-medium">Product Photo</p>
        <p className="text-xs text-muted-foreground">Photo upload isn&apos;t available right now.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">Product Photo</p>

      {value ? (
        <div className="space-y-2">
          <div className="relative">
            <ProductImage src={value} alt="Product photo" size="lg" className="h-40" />
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border hover:bg-accent"
              aria-label="Remove photo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Camera />}
            {uploading ? 'Uploading…' : 'Change Photo'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-7 text-center">
            <Camera className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Add Product Photo</p>
            <p className="text-xs text-muted-foreground">Take a photo or upload</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Camera />}
            {uploading ? 'Uploading…' : 'Add Photo'}
          </Button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
