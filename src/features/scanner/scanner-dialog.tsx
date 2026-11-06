'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScannerPanel, type ScannerPanelProps } from '@/features/scanner/scanner-panel';

/**
 * `ScannerPanel` in a dialog — how most screens open the scanner. The panel
 * is mounted only while the dialog is open, so closing it releases the camera.
 *
 * In `single` mode the dialog closes itself after the first successful code.
 */
export function ScannerDialog({
  open,
  onOpenChange,
  title,
  description,
  onCloseAutoFocus,
  ...panel
}: Omit<ScannerPanelProps, 'title' | 'onDone'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /**
   * Runs once the dialog has fully closed, where focus would go back to the
   * button that opened it; call `event.preventDefault()` to send it elsewhere.
   */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3 p-4 sm:p-6" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <ScannerPanel
          {...panel}
          title={<DialogTitle className="truncate">{title}</DialogTitle>}
          onComplete={() => {
            panel.onComplete?.();
            close();
          }}
          onDone={close}
          doneLabel={panel.mode === 'single' ? 'Cancel' : 'Done'}
        />
      </DialogContent>
    </Dialog>
  );
}
