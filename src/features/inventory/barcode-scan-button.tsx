'use client';

import * as React from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CameraStage,
  ScannerError,
  isRetryable,
  supportFailure,
  type CameraFailure,
} from '@/features/inventory/camera-stage';

/**
 * One-shot camera scan for a form field — the product forms use it to fill in
 * a barcode, then it closes. The till uses `PosCameraScanner` instead, which
 * keeps the camera open between items. Both share `CameraStage`.
 */

type ScanState = 'starting' | 'scanning' | CameraFailure;

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
  const [state, setState] = React.useState<ScanState>('starting');

  const openScanner = () => {
    setState(supportFailure() ?? 'starting');
    setOpen(true);
  };

  const handleDetected = React.useCallback(
    (code: string) => {
      onScan(code);
      setOpen(false);
    },
    [onScan],
  );

  const handleReady = React.useCallback(() => setState('scanning'), []);
  const handleFailed = React.useCallback((next: CameraFailure) => setState(next), []);

  const manualEntry = (
    <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
      Enter barcode manually
    </Button>
  );

  const live = state === 'starting' || state === 'scanning';

  return (
    <>
      <Button type="button" variant="outline" size={size} className={className} onClick={openScanner}>
        <Camera /> {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan Barcode</DialogTitle>
          </DialogHeader>

          {live ? (
            <div className="space-y-3">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-black">
                <CameraStage onReady={handleReady} onFailed={handleFailed} onDetected={handleDetected} />

                {state === 'scanning' && (
                  <div className="pointer-events-none absolute inset-x-8 inset-y-12 rounded-md border-2 border-dashed border-white/80" />
                )}

                {/* Opaque, so there is never a black rectangle to stare at. */}
                {state === 'starting' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">Starting camera…</p>
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-muted-foreground">
                {state === 'scanning'
                  ? 'Point the camera at the barcode.'
                  : 'Allow camera access if your browser asks.'}
              </p>

              <div className="space-y-1">
                <p className="text-center text-xs text-muted-foreground">Can&rsquo;t scan?</p>
                {manualEntry}
                <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <ScannerError state={state} />
              <div className="space-y-1">
                {isRetryable(state) && (
                  <Button type="button" className="w-full" onClick={() => setState('starting')}>
                    Try Again
                  </Button>
                )}
                {manualEntry}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
