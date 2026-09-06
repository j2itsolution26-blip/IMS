'use client';

import * as React from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Minimal typing for the browser's native barcode API — not in lib.dom yet. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'];

/**
 * Opens the phone camera and reads a barcode straight into the field it's
 * attached to. Feature-detected: on a browser without native barcode
 * scanning support, it explains that plainly and the owner just types it in
 * — barcode is optional either way.
 */
export function BarcodeScanButton({ onScan }: { onScan: (code: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const supported =
    typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof navigator.mediaDevices?.getUserMedia === 'function';

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open || !supported) return;

    let cancelled = false;
    let rafId: number;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
        const detector = new Detector({ formats: SCAN_FORMATS });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              onScan(codes[0].rawValue);
              setOpen(false);
              return;
            }
          } catch {
            // Decoding a frame with no visible barcode throws — expected between reads.
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setError('Camera access was blocked. Allow camera access, or type the barcode in manually.');
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stopStream();
    };
  }, [open, supported, onScan, stopStream]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Camera /> Scan
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) stopStream();
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan barcode</DialogTitle>
          </DialogHeader>
          {!supported ? (
            <p className="text-sm text-muted-foreground">
              This device or browser doesn&apos;t support camera scanning. Barcode is optional — you can type it in
              instead.
            </p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-md bg-black">
                <video ref={videoRef} className="aspect-video w-full" muted playsInline />
              </div>
              <p className="text-center text-xs text-muted-foreground">Point the camera at the barcode.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
