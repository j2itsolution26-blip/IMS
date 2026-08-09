'use client';

import * as React from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Confirmation for destructive actions.
 *
 * Built on Radix AlertDialog rather than Dialog so it traps focus and cannot be
 * dismissed by clicking the backdrop — deleting a record by mis-clicking is not
 * a recoverable mistake.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="flex gap-3">
            {destructive && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
              <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </AlertDialog.Description>
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={loading}
              className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
            >
              {loading ? 'Working…' : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
