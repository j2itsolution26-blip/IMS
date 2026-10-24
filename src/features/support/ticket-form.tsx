'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ImagePlus, Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/form';
import { cn } from '@/lib/utils';
import type { ActionResult } from '@/lib/action';
import { BODY_MAX, CATEGORY_INFO, SUBJECT_MAX, SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/support';
import { SUPPORT_MAX_TOTAL_BYTES } from '@/lib/support-files';

/**
 * The "contact support" form, shared by the in-app Support page and the
 * public Help page. Written for a store owner, not a technician: pick what
 * it is about, say it in your own words, optionally add a screenshot.
 *
 * Each render of the form carries a random submission key, so a double click
 * or a retried request is stored once on the server.
 */

type Errors = Partial<Record<'category' | 'subject' | 'description' | 'name' | 'email' | 'attachments', string>>;

export interface TicketFormProps {
  variant: 'app' | 'public';
  action: (form: FormData) => Promise<ActionResult<{ number: string | null }>>;
  maxFiles: number;
  /** Public form only: signed on the server when the page rendered. */
  formToken?: string;
  /** In-app only: "View ticket" goes to this path plus the ticket number. */
  ticketBasePath?: string;
  defaultCategory?: SupportCategory;
  /** A narrow container (the public Help card): categories as a dropdown. */
  compact?: boolean;
}

function newKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function TicketForm({ variant, action, maxFiles, formToken, ticketBasePath, defaultCategory, compact = false }: TicketFormProps) {
  const [submissionKey, setSubmissionKey] = React.useState(newKey);
  const [category, setCategory] = React.useState<SupportCategory | ''>(defaultCategory ?? '');
  const [files, setFiles] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<Errors>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState<{ number: string | null } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, maxFiles);
    const total = next.reduce((sum, file) => sum + file.size, 0);
    setErrors((current) => ({
      ...current,
      attachments: total > SUPPORT_MAX_TOTAL_BYTES ? 'Screenshots must be 5 MB or less in total.' : undefined,
    }));
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    form.delete('attachments');
    for (const file of files) form.append('attachments', file);
    form.set('category', category);
    form.set('submissionKey', submissionKey);

    setPending(true);
    setBanner(null);
    setErrors({});
    try {
      const result = await action(form);
      if (result.ok) {
        setDone({ number: result.data.number });
        return;
      }
      const fieldErrors: Errors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) fieldErrors[field as keyof Errors] = messages[0];
      }
      setErrors(fieldErrors);
      setBanner(Object.keys(fieldErrors).length > 0 ? 'Please check the highlighted fields.' : result.error);
    } catch {
      setBanner('Could not send your message. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 px-2 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success-text">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold">Your message was sent</h2>
        {done.number && (
          <p className="text-sm text-muted-foreground">
            Your ticket number is{' '}
            <span className="font-mono text-base font-semibold text-foreground">{done.number}</span>. Keep it in
            case you need to follow up.
          </p>
        )}
        <p className="max-w-sm text-sm text-muted-foreground">
          {variant === 'public'
            ? 'Our support team will reply to the email address you gave.'
            : 'Our support team will reply here. You will see a badge on Support when they do.'}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {done.number && ticketBasePath && (
            <Button asChild>
              <Link href={`${ticketBasePath}${done.number}`}>View ticket</Link>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              formRef.current?.reset();
              setFiles([]);
              setCategory(defaultCategory ?? '');
              setSubmissionKey(newKey());
              setDone(null);
            }}
          >
            Send another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5" aria-busy={pending || undefined}>
      <FormError message={banner} />

      {variant === 'public' && (
        <>
          <input type="hidden" name="formToken" value={formToken ?? ''} />
          {/* Hidden from people and from screen readers; only a bot fills it. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="support-website">Website</label>
            <input id="support-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
            <FormField id="support-name" label="Your name" error={errors.name} required>
              <Input id="support-name" name="name" autoComplete="name" maxLength={100} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? 'support-name-error' : undefined} />
            </FormField>
            <FormField id="support-email" label="Email for our reply" error={errors.email} required>
              <Input
                id="support-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                aria-invalid={Boolean(errors.email) || undefined}
                aria-describedby={errors.email ? 'support-email-error' : undefined}
              />
            </FormField>
          </div>
        </>
      )}

      {compact ? (
        <FormField id="support-category" label="What is it about?" error={errors.category} required>
          <select
            id="support-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as SupportCategory)}
            aria-invalid={Boolean(errors.category) || undefined}
            aria-describedby={errors.category ? 'support-category-error' : undefined}
            className="h-9 w-full rounded-full border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-[invalid=true]:border-destructive"
          >
            <option value="" disabled>
              Choose a category
            </option>
            {SUPPORT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_INFO[value].label}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            What is it about?<span className="ml-0.5 text-destructive-text" aria-hidden="true">*</span>
          </legend>
          <div role="radiogroup" aria-invalid={Boolean(errors.category) || undefined} className="grid gap-2 sm:grid-cols-2">
            {SUPPORT_CATEGORIES.map((value) => {
              const info = CATEGORY_INFO[value];
              const checked = category === value;
              return (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors',
                    'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                    checked ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <input
                    type="radio"
                    name="category-choice"
                    value={value}
                    checked={checked}
                    onChange={() => setCategory(value)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{info.label}</span>
                    <span className="block text-xs text-muted-foreground">{info.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.category && <p className="text-xs text-destructive-text">{errors.category}</p>}
        </fieldset>
      )}

      <FormField id="support-subject" label="Subject" error={errors.subject} description="A short title, e.g. “Receipt prints twice”." required>
        <Input
          id="support-subject"
          name="subject"
          maxLength={SUBJECT_MAX}
          aria-invalid={Boolean(errors.subject) || undefined}
          aria-describedby={errors.subject ? 'support-subject-error' : 'support-subject-description'}
        />
      </FormField>

      <FormField
        id="support-description"
        label="Tell us what happened"
        error={errors.description}
        description="What were you doing, what did you expect, and what happened instead?"
        required
      >
        <Textarea
          id="support-description"
          name="description"
          rows={6}
          maxLength={BODY_MAX}
          aria-invalid={Boolean(errors.description) || undefined}
          aria-describedby={errors.description ? 'support-description-error' : 'support-description-description'}
        />
      </FormField>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            id="support-attachments"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple={maxFiles > 1}
            className="sr-only"
            onChange={(event) => addFiles(event.target.files)}
            disabled={files.length >= maxFiles}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={files.length >= maxFiles}
            aria-describedby="support-attachments-hint"
          >
            <ImagePlus aria-hidden="true" /> {maxFiles === 1 ? 'Add a screenshot' : 'Add screenshots'}
          </Button>
          <span id="support-attachments-hint" className="text-xs text-muted-foreground">
            Optional · PNG, JPG or WEBP · {maxFiles === 1 ? 'one image' : `up to ${maxFiles}`}, 5 MB total
          </span>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-3 pr-1 text-xs">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="rounded-full p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.attachments && <p className="text-xs text-destructive-text">{errors.attachments}</p>}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {variant === 'public'
            ? 'Never include your password. We will never ask for it.'
            : 'Never include passwords or PINs. Support will never ask for them.'}
        </p>
        <Button type="submit" disabled={pending || Boolean(errors.attachments)} aria-busy={pending || undefined}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          {pending ? 'Sending…' : 'Send to support'}
        </Button>
      </div>
    </form>
  );
}
