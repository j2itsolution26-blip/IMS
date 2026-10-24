'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader2, Lock, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { FormError } from '@/components/form';
import { cn } from '@/lib/utils';
import type { ActionResult } from '@/lib/action';
import { BODY_MAX } from '@/lib/support';
import { SUPPORT_MAX_FILES, SUPPORT_MAX_TOTAL_BYTES } from '@/lib/support-files';

/**
 * The box under a conversation. Requesters write a reply; administrators
 * choose between a reply the requester reads and an internal note they never
 * see — the choice is explicit, labelled, and changes the box's colour, so a
 * note is never sent as a reply by accident. The server decides what the
 * reply does to the status.
 */
export function ReplyForm({
  viewer,
  action,
  noteAction,
  notesOnly = false,
  hint,
}: {
  viewer: 'requester' | 'admin';
  action: (form: FormData) => Promise<ActionResult<unknown>>;
  /** Administrators only. */
  noteAction?: (form: FormData) => Promise<ActionResult<unknown>>;
  /** Administrators on a closed ticket: internal notes only. */
  notesOnly?: boolean;
  hint?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'reply' | 'note'>(notesOnly ? 'note' : 'reply');
  const [files, setFiles] = React.useState<File[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const note = viewer === 'admin' && mode === 'note';
  const tooLarge = files.reduce((sum, file) => sum + file.size, 0) > SUPPORT_MAX_TOTAL_BYTES;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    form.delete('attachments');
    if (!note) for (const file of files) form.append('attachments', file);
    setPending(true);
    setError(null);
    try {
      const result = await (note && noteAction ? noteAction : action)(form);
      if (!result.ok) {
        setError(result.fieldErrors?.message?.[0] ?? result.fieldErrors?.attachments?.[0] ?? result.error);
        return;
      }
      formRef.current?.reset();
      setFiles([]);
      toast.success(note ? 'Internal note added.' : 'Reply sent.');
      router.refresh();
    } catch {
      setError('Could not send. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-3" aria-busy={pending || undefined}>
      {viewer === 'admin' && !notesOnly && (
        <div role="tablist" aria-label="Message type" className="inline-flex rounded-full border p-0.5 text-sm">
          {(['reply', 'note'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === value
                  ? value === 'note'
                    ? 'bg-warning/20 text-warning-text'
                    : 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'note' && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
              {value === 'reply' ? 'Reply to requester' : 'Internal note'}
            </button>
          ))}
        </div>
      )}

      <FormError message={error} />

      <label htmlFor="support-reply" className="sr-only">
        {note ? 'Internal note' : 'Your reply'}
      </label>
      <Textarea
        id="support-reply"
        name="message"
        rows={4}
        maxLength={BODY_MAX}
        required
        placeholder={
          note ? 'Only administrators can read this note.' : viewer === 'admin' ? 'Write your reply to the requester…' : 'Write your reply…'
        }
        className={cn(note && 'border-dashed border-warning/60 bg-warning/5')}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {!note && (
            <>
              <input
                ref={fileInput}
                id="support-reply-attachments"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const list = event.target.files;
                  if (list) setFiles((current) => [...current, ...Array.from(list)].slice(0, SUPPORT_MAX_FILES));
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={files.length >= SUPPORT_MAX_FILES}
              >
                <ImagePlus aria-hidden="true" /> Screenshot
              </Button>
              {files.map((file, index) => (
                <span key={`${file.name}-${index}`} className="flex max-w-[12rem] items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </>
          )}
          {viewer === 'admin' && !note && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="waitForUser" value="1" className="h-4 w-4 accent-primary" />
              Ask for more information (set “Waiting for user”)
            </label>
          )}
          {tooLarge && <span className="text-xs text-destructive-text">Screenshots must be 5 MB or less in total.</span>}
          {hint && !tooLarge && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        <Button type="submit" disabled={pending || tooLarge} variant={note ? 'secondary' : 'default'} className="sm:self-end">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : note ? <Lock aria-hidden="true" /> : <Send aria-hidden="true" />}
          {pending ? 'Sending…' : note ? 'Add note' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
