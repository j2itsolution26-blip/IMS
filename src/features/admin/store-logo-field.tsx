'use client';

import * as React from 'react';
import { AlertCircle, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { removeStoreLogoAction, uploadStoreLogoAction } from '@/features/admin/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { LOGO_TYPES, logoFileProblem } from '@/features/admin/settings-sections';
import { cn } from '@/lib/utils';

type Status = { kind: 'idle' } | { kind: 'uploading'; preview: string } | { kind: 'removing' };

/**
 * The store logo: preview, upload, replace and remove.
 *
 * Saved on its own, straight away — not with the rest of the form — because a
 * file cannot wait in a draft. The saved logo stays in place until a
 * replacement has been stored; the server removes the old file only then.
 */
export function StoreLogoField({
  id,
  label,
  description,
  url,
  disabled,
  onStored,
}: {
  id: string;
  label: string;
  description: string;
  url: string;
  disabled: boolean;
  onStored: (url: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [broken, setBroken] = React.useState(false);

  const busy = status.kind !== 'idle';
  const shown = status.kind === 'uploading' ? status.preview : url;

  React.useEffect(() => setBroken(false), [shown]);

  // The local preview is a blob URL; release it once it is no longer shown.
  React.useEffect(() => {
    if (status.kind !== 'uploading') return;
    const preview = status.preview;
    return () => URL.revokeObjectURL(preview);
  }, [status]);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change.
    event.target.value = '';
    if (!file || busy) return;

    const problem = logoFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setStatus({ kind: 'uploading', preview: URL.createObjectURL(file) });
    const form = new FormData();
    form.append('file', file);
    const result = await uploadStoreLogoAction(form);
    setStatus({ kind: 'idle' });

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onStored(result.data.url);
    toast.success(url ? 'Logo replaced.' : 'Logo uploaded.');
  };

  const onRemove = async () => {
    setStatus({ kind: 'removing' });
    const result = await removeStoreLogoAction();
    setStatus({ kind: 'idle' });
    setConfirming(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onStored('');
    toast.success('Logo removed.');
  };

  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <div className="min-w-0 sm:col-span-2" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        {label}
      </p>

      <div className="mt-2 flex flex-col gap-4 rounded-lg border bg-background/60 p-4 sm:flex-row sm:items-center">
        <div
          className={cn(
            'relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted',
            !shown && 'border-dashed',
          )}
        >
          {shown && !broken ? (
            // A plain <img>: the logo may be hosted anywhere, and next/image
            // refuses hosts that are not configured (see ProductImage).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt={status.kind === 'uploading' ? 'New logo preview' : 'Current store logo'}
              className="h-full w-full object-contain p-1.5"
              onError={() => setBroken(true)}
            />
          ) : (
            <ImageIcon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          )}
          {status.kind === 'uploading' && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {broken && url ? 'The saved logo could not be loaded. Upload it again. ' : !url ? 'No logo yet. ' : ''}
            {description} PNG, JPG or WEBP, up to 5 MB. A square image with a transparent background works best.
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              id={id}
              type="file"
              accept={LOGO_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              disabled={disabled || busy}
              onChange={onFile}
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 sm:h-9"
              disabled={disabled || busy}
              loading={status.kind === 'uploading'}
              aria-describedby={error ? `${errorId} ${descriptionId}` : descriptionId}
              onClick={() => inputRef.current?.click()}
            >
              {status.kind !== 'uploading' && <Upload aria-hidden="true" />}
              {status.kind === 'uploading' ? 'Uploading…' : url ? 'Replace logo' : 'Upload logo'}
            </Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 text-destructive-text hover:text-destructive-text sm:h-9"
                disabled={disabled || busy}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {status.kind === 'uploading' ? 'Uploading logo…' : ''}
          </p>
          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive-text">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => status.kind !== 'removing' && setConfirming(open)}
        title="Remove the store logo?"
        description="The logo is deleted from storage. You can upload a new one at any time."
        confirmLabel="Remove logo"
        loading={status.kind === 'removing'}
        loadingLabel="Removing…"
        onConfirm={onRemove}
      />
    </div>
  );
}
