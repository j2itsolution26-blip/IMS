'use client';

import * as React from 'react';
import type { FieldError, FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ActionResult } from '@/lib/action';

/**
 * Thin form helpers over react-hook-form.
 *
 * Deliberately not a full Form abstraction — wiring `register()` directly keeps
 * each form readable, and this only handles the parts that would otherwise be
 * copy-pasted: label/error/description layout and the accessibility attributes
 * that are easy to forget.
 */

export function FormField({
  id,
  label,
  error,
  description,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: FieldError | string;
  description?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const message = typeof error === 'string' ? error : error?.message;
  const describedBy = [description ? `${id}-description` : null, message ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>

      {/* The control receives aria-describedby without each form repeating it. */}
      <FieldContext.Provider value={{ id, describedBy: describedBy || undefined, invalid: Boolean(message) }}>
        {children}
      </FieldContext.Provider>

      {description && !message && (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {message && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Props to spread onto the control inside a `FormField`. */
export function useFieldProps() {
  const context = React.useContext(FieldContext);
  if (!context) return {};
  return {
    id: context.id,
    'aria-describedby': context.describedBy,
    'aria-invalid': context.invalid || undefined,
  };
}

/** Server-side failure banner shown above a form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Pushes field errors returned by a server action back into the form, so a
 * uniqueness clash raised by the database lands on the field that caused it.
 */
export function applyServerErrors<T extends FieldValues>(
  result: Extract<ActionResult<unknown>, { ok: false }>,
  setError: UseFormSetError<T>,
): string | null {
  if (result.fieldErrors) {
    for (const [field, messages] of Object.entries(result.fieldErrors)) {
      const message = messages?.[0];
      // The server names fields by the same keys the schema uses, so this cast
      // is safe; anything unmatched simply lands on no visible control.
      if (message) setError(field as Path<T>, { type: 'server', message });
    }
    // Field-level messages are already visible; no banner needed.
    if (Object.keys(result.fieldErrors).length > 0) return null;
  }
  return result.error;
}
