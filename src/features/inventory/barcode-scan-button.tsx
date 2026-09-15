'use client';

import * as React from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, CameraOff, Loader2, ShieldAlert, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Camera barcode scanning for a phone with no physical scanner.
 *
 * Two things caused the black preview this replaces. The <video> was rendered
 * conditionally on a state flag, so it often did not exist yet when the stream
 * arrived and the failure was swallowed; and the decoding library was left to
 * do the attaching, which hid whether playback ever actually started.
 *
 * So the camera now lives in `CameraStage`, the component that owns the
 * element: its effect cannot run before its own <video> is in the DOM, which
 * a ref read from an ancestor across Radix's portal genuinely can. The stage
 * drives the whole sequence itself — getUserMedia, srcObject, loadedmetadata,
 * play(), then a check for real frame dimensions — and reports failure at
 * whichever step broke instead of leaving a black rectangle on screen.
 *
 * Decoding prefers the native BarcodeDetector where it exists (Android
 * Chrome/Edge — hardware accelerated) and falls back to ZXing everywhere else.
 * The fallback is not optional: iOS has no BarcodeDetector at all, in Safari
 * or in Chrome, since every iOS browser is WebKit underneath.
 */

const ZXING_HINTS = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
    ],
  ],
]);

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

/** ~8 decode attempts a second reads fast without cooking the battery. */
const DECODE_INTERVAL_MS = 120;
const METADATA_TIMEOUT_MS = 10_000;

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

type ScanState =
  | 'starting' // stream requested, nothing to show yet
  | 'scanning' // live preview, decoding
  | 'insecure' // page is not HTTPS (and isn't localhost)
  | 'unsupported' // browser has no getUserMedia
  | 'denied' // permission refused
  | 'no-camera' // no camera on this device
  | 'in-use' // camera held by another app
  | 'error';

type FailureState = Exclude<ScanState, 'starting' | 'scanning'>;

function classifyCameraError(error: unknown): FailureState {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no-camera';
    case 'NotSupportedError':
      return 'unsupported';
    // Allowed and present, but it would not start — nearly always another app
    // or browser tab already holding the camera.
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'error';
  }
}

/** Resolves once the browser knows the stream's real dimensions. */
function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('The camera stream could not be loaded.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the camera.'));
    }, METADATA_TIMEOUT_MS);

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

/**
 * Attaches the stream and gets it actually playing.
 *
 * Throws unless there are real frames at the end of it, so a camera that
 * connects but produces nothing surfaces as an error rather than a black box.
 */
async function attachAndPlay(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  // iOS only honours these as attributes — without them Safari takes the
  // stream fullscreen instead of playing it inline, which reads as a failure.
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('muted', 'true');

  await waitForMetadata(video);
  // Autoplay is unreliable on mobile even when muted, so always ask.
  await video.play();

  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('The camera did not produce any video.');
  }
}

/**
 * Owns the <video> and everything attached to it.
 *
 * Mounted only while the camera should be running, so unmounting is the single
 * teardown path — closing the dialog, hitting an error, and a successful scan
 * all release the camera through the same cleanup.
 */
function CameraStage({
  onReady,
  onFailed,
  onDetected,
}: {
  onReady: () => void;
  onFailed: (state: FailureState) => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Read through refs so the camera effect can run exactly once per mount
  // without a changing callback identity restarting it.
  const callbacks = React.useRef({ onReady, onFailed, onDetected });
  React.useEffect(() => {
    callbacks.current = { onReady, onFailed, onDetected };
  });

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let zxingControls: IScannerControls | null = null;
    let decodeTimer: ReturnType<typeof setTimeout> | null = null;

    const stopCamera = () => {
      if (decodeTimer) {
        clearTimeout(decodeTimer);
        decodeTimer = null;
      }
      zxingControls?.stop();
      zxingControls = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
    };

    const finish = (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || cancelled) return;
      cancelled = true;
      stopCamera();
      callbacks.current.onDetected(trimmed);
    };

    const decodeWithZxing = () => {
      const reader = new BrowserMultiFormatReader(ZXING_HINTS, {
        delayBetweenScanAttempts: DECODE_INTERVAL_MS,
        delayBetweenScanSuccess: DECODE_INTERVAL_MS,
      });
      // Decode errors fire constantly and harmlessly — "no barcode in this
      // frame" is the normal state of a scanner that is still searching.
      zxingControls = reader.scan(video, (result) => {
        if (result) finish(result.getText());
      });
    };

    const decodeWithNative = async (Detector: BarcodeDetectorCtor): Promise<boolean> => {
      let detector: BarcodeDetectorInstance;
      try {
        const supported = (await Detector.getSupportedFormats?.()) ?? NATIVE_FORMATS;
        const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
        if (formats.length === 0) return false;
        detector = new Detector({ formats });
      } catch {
        return false;
      }
      if (cancelled) return true;

      const tick = async () => {
        if (cancelled) return;
        try {
          const hit = (await detector.detect(video)).find((code) => code.rawValue);
          if (hit) {
            finish(hit.rawValue);
            return;
          }
        } catch {
          // A detect() that fails mid-stream is not fatal; try the next frame.
        }
        if (cancelled) return;
        decodeTimer = setTimeout(() => void tick(), DECODE_INTERVAL_MS);
      };

      void tick();
      return true;
    };

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (error) {
        if (!cancelled) callbacks.current.onFailed(classifyCameraError(error));
        return;
      }

      // The dialog can be dismissed while the permission prompt is still up.
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        return;
      }

      try {
        await attachAndPlay(video, stream);
      } catch {
        stopCamera();
        if (!cancelled) callbacks.current.onFailed('error');
        return;
      }
      if (cancelled) return;

      callbacks.current.onReady();

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Detector || !(await decodeWithNative(Detector))) {
        if (!cancelled) decodeWithZxing();
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  return <video ref={videoRef} className="h-full w-full object-contain" muted playsInline autoPlay />;
}

export function BarcodeScanButton({ onScan }: { onScan: (code: string) => void }) {
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
  const handleFailed = React.useCallback((next: FailureState) => setState(next), []);

  const manualEntry = (
    <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
      Enter barcode manually
    </Button>
  );

  const live = state === 'starting' || state === 'scanning';

  return (
    <>
      <Button type="button" variant="outline" onClick={openScanner}>
        <Camera /> Scan Barcode
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
                {state !== 'no-camera' && state !== 'unsupported' && state !== 'insecure' && (
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

/** Reasons the camera can't even be attempted, checked before opening. */
function supportFailure(): FailureState | null {
  if (!window.isSecureContext) return 'insecure';
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported';
  return null;
}

const ERROR_CONTENT: Record<FailureState, { icon: React.ReactNode; title: string; body?: string }> = {
  denied: {
    icon: <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden="true" />,
    title: 'Camera access was denied.',
    body: 'Allow camera access in your browser settings to scan barcodes.',
  },
  'no-camera': {
    icon: <CameraOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />,
    title: 'No camera was found on this device.',
  },
  'in-use': {
    icon: <CameraOff className="h-8 w-8 text-warning" aria-hidden="true" />,
    title: 'The camera is currently being used by another application.',
    body: 'Close the other app or tab using the camera, then try again.',
  },
  unsupported: {
    icon: <VideoOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />,
    title: 'Barcode scanning is not supported by this browser.',
  },
  insecure: {
    icon: <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />,
    title: 'Barcode scanning needs a secure (HTTPS) connection.',
  },
  error: {
    icon: <VideoOff className="h-8 w-8 text-destructive" aria-hidden="true" />,
    title: 'Couldn’t start the camera.',
    body: 'Something went wrong getting the camera going.',
  },
};

function ScannerError({ state }: { state: FailureState }) {
  const meta = ERROR_CONTENT[state];

  return (
    <div className="space-y-2 py-2 text-center">
      <div className="mx-auto w-fit">{meta.icon}</div>
      <p className="text-sm font-medium">{meta.title}</p>
      {meta.body && <p className="text-sm text-muted-foreground">{meta.body}</p>}
    </div>
  );
}
