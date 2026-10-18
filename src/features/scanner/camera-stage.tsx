'use client';

import * as React from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraOff, ShieldAlert, VideoOff } from 'lucide-react';

/**
 * The camera half of barcode scanning. `ScannerPanel` builds the scanner the
 * till and the inventory screens share on top of it.
 *
 * Two things caused the black preview this replaced. The <video> was rendered
 * conditionally on a state flag, so it often did not exist yet when the stream
 * arrived and the failure was swallowed; and the decoding library was left to
 * do the attaching, which hid whether playback ever actually started.
 *
 * So the camera lives in `CameraStage`, the component that owns the element:
 * its effect cannot run before its own <video> is in the DOM, which a ref read
 * from an ancestor across Radix's portal genuinely can. The stage drives the
 * whole sequence itself — getUserMedia, srcObject, loadedmetadata, play(),
 * then a check for real frame dimensions — and reports failure at whichever
 * step broke instead of leaving a black rectangle on screen.
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
      BarcodeFormat.ITF,
    ],
  ],
]);

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

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

export type CameraFailure =
  | 'insecure' // page is not HTTPS (and isn't localhost)
  | 'unsupported' // browser has no getUserMedia
  | 'denied' // permission refused
  | 'no-camera' // no camera on this device
  | 'in-use' // camera held by another app
  | 'error';

function classifyCameraError(error: unknown): CameraFailure {
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

/** A decode loop that can be stopped and restarted on the same stream. */
interface DecodeLoop {
  start(): void;
  stop(): void;
}

function zxingLoop(video: HTMLVideoElement, onCode: (code: string) => void): DecodeLoop {
  const reader = new BrowserMultiFormatReader(ZXING_HINTS, {
    delayBetweenScanAttempts: DECODE_INTERVAL_MS,
    delayBetweenScanSuccess: DECODE_INTERVAL_MS,
  });
  let controls: IScannerControls | null = null;

  return {
    start() {
      if (controls) return;
      // Decode errors fire constantly and harmlessly — "no barcode in this
      // frame" is the normal state of a scanner that is still searching.
      // Without a finalize callback, stop() halts this loop only; the stream
      // stays attached so a paused scanner resumes instantly.
      controls = reader.scan(video, (result) => {
        if (result) onCode(result.getText());
      });
    },
    stop() {
      controls?.stop();
      controls = null;
    },
  };
}

async function nativeLoop(
  Detector: BarcodeDetectorCtor,
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<DecodeLoop | null> {
  let detector: BarcodeDetectorInstance;
  try {
    const supported = (await Detector.getSupportedFormats?.()) ?? NATIVE_FORMATS;
    const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
    if (formats.length === 0) return null;
    detector = new Detector({ formats });
  } catch {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  // Bumped on every start/stop so a detect() still in flight from a previous
  // run can't spin up a second loop beside the new one.
  let generation = 0;

  const tick = async (run: number) => {
    if (run !== generation) return;
    try {
      const hit = (await detector.detect(video)).find((code) => code.rawValue);
      if (hit && run === generation) onCode(hit.rawValue);
    } catch {
      // A detect() that fails mid-stream is not fatal; try the next frame.
    }
    if (run !== generation) return;
    timer = setTimeout(() => void tick(run), DECODE_INTERVAL_MS);
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      void tick(generation);
    },
    stop() {
      running = false;
      generation += 1;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function videoConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    // A specific camera when the cashier picked one; otherwise the rear camera
    // on a phone, and whatever exists on a laptop.
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    // 1D barcodes are thin bars — more horizontal pixels decode them sooner.
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
}

/**
 * Owns the <video> and everything attached to it.
 *
 * Mounted only while the camera should be running, so unmounting is the single
 * teardown path — closing the dialog, stopping, hitting an error and switching
 * cameras all release the camera through the same cleanup. There is never more
 * than one stream per stage.
 *
 * Every read is reported, including a code that is simply still in view; the
 * caller's duplicate gate decides what counts. `paused` stops decoding and
 * freezes the preview without giving up the camera; `holdDecoding` stops
 * decoding but keeps the preview live (e.g. while a quantity is typed).
 */
export function CameraStage({
  onReady,
  onFailed,
  onDetected,
  paused = false,
  holdDecoding = false,
  deviceId,
  className = 'h-full w-full object-contain',
}: {
  onReady: (info: { deviceId?: string }) => void;
  onFailed: (state: CameraFailure) => void;
  onDetected: (code: string) => void;
  paused?: boolean;
  holdDecoding?: boolean;
  deviceId?: string;
  className?: string;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Read through refs so the camera effect can run exactly once per mount
  // without a changing callback identity restarting it.
  const callbacks = React.useRef({ onReady, onFailed, onDetected });
  React.useEffect(() => {
    callbacks.current = { onReady, onFailed, onDetected };
  });

  const pausedRef = React.useRef(paused);
  // Whether decoding should be running at all — off while paused or held.
  const decodingRef = React.useRef(!paused && !holdDecoding);
  const loopRef = React.useRef<DecodeLoop | null>(null);

  React.useEffect(() => {
    pausedRef.current = paused;
    decodingRef.current = !paused && !holdDecoding;
    const video = videoRef.current;
    const loop = loopRef.current;
    // Before the camera is live there is nothing to pause; the start-up
    // sequence reads these refs itself.
    if (!video || !loop) return;

    if (paused) video.pause();
    else void video.play().catch(() => undefined);

    if (decodingRef.current) loop.start();
    else loop.stop();
  }, [paused, holdDecoding]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const stopCamera = () => {
      loopRef.current?.stop();
      loopRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
    };

    const handleCode = (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || cancelled || !decodingRef.current) return;
      callbacks.current.onDetected(trimmed);
    };

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(deviceId),
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

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      callbacks.current.onReady({ deviceId: activeDeviceId });

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      const loop = (Detector && (await nativeLoop(Detector, video, handleCode))) || zxingLoop(video, handleCode);
      if (cancelled) return;

      loopRef.current = loop;
      if (pausedRef.current) video.pause();
      if (decodingRef.current) loop.start();
    };

    void run();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // The stage is keyed by its caller to switch cameras, so these never
    // change for the life of one mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <video ref={videoRef} className={className} muted playsInline autoPlay />;
}

/** Reasons the camera can't even be attempted, checked before opening. */
export function supportFailure(): CameraFailure | null {
  if (!window.isSecureContext) return 'insecure';
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported';
  return null;
}

/**
 * The cameras on this device. Labels are blank until camera permission has
 * been granted, so call this once a stream is running.
 */
export async function listCameras(): Promise<{ deviceId: string; label: string }[]> {
  if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

const ERROR_CONTENT: Record<CameraFailure, { icon: React.ReactNode; title: string; body?: string }> = {
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

/** Failures where trying again could plausibly work. */
export function isRetryable(state: CameraFailure): boolean {
  return state !== 'no-camera' && state !== 'unsupported' && state !== 'insecure';
}

export function ScannerError({ state }: { state: CameraFailure }) {
  const meta = ERROR_CONTENT[state];

  return (
    <div className="space-y-2 py-2 text-center">
      <div className="mx-auto w-fit">{meta.icon}</div>
      <p className="text-sm font-medium">{meta.title}</p>
      {meta.body && <p className="text-sm text-muted-foreground">{meta.body}</p>}
    </div>
  );
}
