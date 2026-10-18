'use client';

import * as React from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScannerDialog } from '@/features/scanner/scanner-dialog';
import { primeAudio } from '@/features/scanner/scanner-panel';

/**
 * One-shot camera scan for a form field — the Add and Edit Product forms use
 * it to fill in a barcode, then it closes. It is the shared scanner in
 * `single` mode, so it looks and behaves exactly like the till's.
 *
 * Only the field is filled: the form still validates and saves as usual, and
 * its duplicate notice flags a code that already belongs to a product.
 */
export function BarcodeScanButton({
  onScan,
  label = 'Scan Barcode',
  size,
  className,
}: {
  onScan: (code: string) => void;
  label?: string;
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        onClick={() => {
          primeAudio();
          setOpen(true);
        }}
      >
        <Camera /> {label}
      </Button>

      <ScannerDialog
        open={open}
        onOpenChange={setOpen}
        title="Scan barcode"
        description="Position the barcode inside the frame. The barcode field is filled in as soon as it reads."
        mode="single"
        manualEntry={false}
        onBarcodeDetected={(code) => {
          onScan(code);
          return { tone: 'success', title: 'Barcode captured' };
        }}
      />
    </>
  );
}
