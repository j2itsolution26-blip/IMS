'use client';

import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/action';

/**
 * A form that calls a server action without React's automatic form reset, so
 * a validation error keeps what the user typed. The action may redirect.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitClassName = 'btn-primary',
  confirm,
  className = 'space-y-4',
  resetOnSuccess = false,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  submitClassName?: string;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const result = await action(fd);
          setMessage(result ?? null);
          if (result?.ok && resetOnSuccess) form.reset();
        });
      }}
    >
      {children}
      {message?.error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {message.error}
        </p>
      )}
      {message?.ok && (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message.ok}
        </p>
      )}
      <button type="submit" className={submitClassName} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
