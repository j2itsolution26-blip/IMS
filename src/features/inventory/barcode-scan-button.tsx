'use client';

import * as React from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { Camera, ShieldAlert, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Camera-based barcode scanning for a phone with no physical scanner.
 *
 * Uses ZXing rather than the native `BarcodeDetector` API: `BarcodeDetector`
 * doesn't exist at all on iOS Safari or iOS Chrome (iOS forces WebKit
 * regardless of browser), which would silently drop two of the four
 * platforms this needs to support. ZXing runs on plain `getUserMedia` +
 * `<video>`, so it works identically everywhere.
 */

// Retail formats only — restricting the decoder to these keeps detection
// fast and avoids false positives from QR codes or other symbologies.
const HINTS = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128],
  ],
]);

type ScanState =
  | 'idle' // "Allow camera access…" prompt, not requested yet
  | 'insecure' // page is not served over HTTPS (and isn't localhost)
  | 'unsupported' // browser has no getUserMedia at all
  | 'requesting' // permission prompt in flight
  | 'scanning' // camera live, decoding
  | 'denied' // permission was refused
  | 'no-camera' // no camera device found on this hardware
  | 'error'; // anything else

function classifyMediaError(error: unknown): ScanState {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'no-camera';
  }
  return 'error';
}

export function BarcodeScanButton({ onScan }: { onScan: (code: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<ScanState>('idle');
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const readerRef = React.useRef<BrowserMultiFormatReader | null>(null);

  const stopScanning = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startScanning = React.useCallback(async () => {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setState('scanning');

      // Attaching the ref happens on the next render (state just flipped to
      // 'scanning'), so wait a tick for the <video> element to exist.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!videoRef.current) return;

      if (!readerRef.current) readerRef.current = new BrowserMultiFormatReader(HINTS);

      const controls = await readerRef.current.decodeFromStream(stream, videoRef.current, (result, error) => {
        if (result) {
          stopScanning();
          onScan(result.getText());
          setOpen(false);
          return;
        }
        // NotFoundException fires on every frame with no visible barcode —
        // that is the normal, expected state while the camera is searching.
        if (error && !(error instanceof NotFoundException)) {
          setState('error');
        }
      });
      controlsRef.current = controls;
    } catch (error) {
      setState(classifyMediaError(error));
    }
  }, [onScan, stopScanning]);

  const openScanner = () => {
    setOpen(true);

    if (!window.isSecureContext) {
      setState('insecure');
      return;
    }
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setState('unsupported');
      return;
    }
    setState('idle');
  };

  const close = () => {
    stopScanning();
    setOpen(false);
  };

  // Stop the camera the moment the dialog is dismissed by any means (Esc,
  // overlay click, or our own close()) — a scanner left running in the
  // background is exactly the kind of thing that gets a store's wifi camera
  // permission revoked by an annoyed owner.
  React.useEffect(() => {
    if (!open) stopScanning();
  }, [open, stopScanning]);

  React.useEffect(() => stopScanning, [stopScanning]);

  return (
    <>
      <Button type="button" variant="outline" onClick={openScanner}>
        <Camera /> Scan Barcode
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan Barcode</DialogTitle>
          </DialogHeader>

          {state === 'insecure' && (
            <ScannerMessage
              icon={<ShieldAlert className="h-8 w-8 text-warning" />}
              message="Camera scanning requires a secure connection (HTTPS)."
              actionLabel="Enter Barcode Manually"
              onAction={close}
            />
          )}

          {state === 'unsupported' && (
            <ScannerMessage
              icon={<VideoOff className="h-8 w-8 text-muted-foreground" />}
              message="This device or browser doesn't support camera scanning."
              actionLabel="Enter Barcode Manually"
              onAction={close}
            />
          )}

          {state === 'no-camera' && (
            <ScannerMessage
              icon={<VideoOff className="h-8 w-8 text-muted-foreground" />}
              message="Camera scanning isn't available on this device."
              actionLabel="Enter Barcode Manually"
              onAction={close}
            />
          )}

          {(state === 'idle' || state === 'requesting') && (
            <div className="space-y-4 py-2 text-center">
              <Camera className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Allow camera access to scan product barcodes.</p>
              <Button type="button" onClick={startScanning} loading={state === 'requesting'} className="w-full">
                Allow Camera
              </Button>
              <button
                type="button"
                onClick={close}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Enter barcode manually
              </button>
            </div>
          )}

          {state === 'denied' && (
            <div className="space-y-3 py-2 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
              <p className="text-sm text-destructive">Camera access was blocked.</p>
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={startScanning} className="w-full">
                  Try Again
                </Button>
                <button
                  type="button"
                  onClick={close}
                  className="text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Enter barcode manually
                </button>
              </div>
            </div>
          )}

          {state === 'error' && (
            <ScannerMessage
              icon={<VideoOff className="h-8 w-8 text-destructive" />}
              message="Something went wrong reading the camera. You can try again or type the barcode in."
              actionLabel="Try Again"
              onAction={startScanning}
              secondaryLabel="Enter barcode manually"
              onSecondary={close}
            />
          )}

          {state === 'scanning' && (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-lg border-2 border-primary/40 bg-black">
                <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline autoPlay />
                <div className="pointer-events-none absolute inset-6 rounded-md border-2 border-dashed border-white/70" />
              </div>
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <Video className="h-3.5 w-3.5" aria-hidden="true" />
                Point your camera at the product barcode.
              </p>
              <Button type="button" variant="outline" onClick={close} className="w-full">
                Cancel
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScannerMessage({
  icon,
  message,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  icon: React.ReactNode;
  message: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="space-y-3 py-2 text-center">
      <div className="mx-auto w-fit">{icon}</div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" onClick={onAction} className="w-full">
        {actionLabel}
      </Button>
      {secondaryLabel && onSecondary && (
        <button
          type="button"
          onClick={onSecondary}
          className="block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
