'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CameraOff,
  CheckCircle2,
  CornerDownLeft,
  Loader2,
  Pause,
  Play,
  Power,
  ScanLine,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CameraStage,
  ScannerError,
  isRetryable,
  listCameras,
  supportFailure,
  type CameraFailure,
} from '@/features/scanner/camera-stage';
import { admitRead, type LastRead } from '@/features/scanner/scan-gate';

/**
 * The one barcode scanner the app has — the till and every inventory screen
 * use this panel, so camera start-up, decoding, the aiming line, duplicate
 * protection and clean-up live in exactly one place.
 *
 * The panel only *reports* codes. What a code means — ring it up, fill a
 * field, count a unit, receive stock — is decided by the screen through
 * `onBarcodeDetected`, which answers with what to show the operator. The
 * scanner never creates products, changes stock or completes a sale itself.
 *
 * The red line sweeping the frame is purely an on-screen aiming guide drawn
 * over the preview. Decoding reads the camera image itself — the whole frame,
 * not just the line — through `CameraStage`.
 */

/** What the screen wants shown after handling a code. */
export interface ScanFeedback {
  tone: 'success' | 'warning' | 'error';
  title: string;
  /** Shown muted beside the title, e.g. "× 3". */
  meta?: string;
}

export type ScanSource = 'camera' | 'keyboard';

export type BarcodeHandler = (code: string, source: ScanSource) => Promise<ScanFeedback> | ScanFeedback;

type CameraState = 'off' | 'starting' | 'scanning' | CameraFailure;

type Feedback =
  | { status: 'idle' }
  | { status: 'looking'; code: string }
  | { status: 'done'; code: string; result: ScanFeedback };

/** Printable ASCII, and no longer than any real retail symbology produces. */
const PLAUSIBLE_CODE = /^[\x20-\x7E]{1,64}$/;

const SOUND_KEY = 'pos.scanner.sound';

/** Scanners type a whole code within a few ms per key; people don't. */
const WEDGE_KEY_GAP_MS = 50;
const WEDGE_MIN_LENGTH = 4;

// --- Feedback sound -------------------------------------------------------

let audioContext: AudioContext | null = null;

/**
 * Browsers only let audio start from a user gesture, so the context is created
 * (or woken) from the click that opens a scanner, ready for later beeps.
 */
export function primeAudio() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

function beep(kind: 'ok' | 'error') {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;

  // One short high note for a hit; a falling pair for anything else.
  const tones: [frequency: number, offset: number, length: number][] =
    kind === 'ok' ? [[1850, 0, 0.08]] : [[440, 0, 0.11], [300, 0.14, 0.16]];

  for (const [frequency, offset, length] of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime + offset;
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported, or blocked without a recent gesture — purely a nicety.
  }
}

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSoundPreference(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage — the toggle still works for this visit.
  }
}

// --- Panel ----------------------------------------------------------------

export interface ScannerPanelProps {
  /** Decides what a code means and says what to show. Called one at a time. */
  onBarcodeDetected: BarcodeHandler;
  /** The camera could not start, or stopped working. */
  onScanError?: (failure: CameraFailure) => void;
  /** The preview is live and decoding. */
  onScannerReady?: () => void;
  /** The camera was released — Stop, or the panel closing. */
  onScannerStopped?: () => void;
  /**
   * `continuous` keeps scanning after each code, for item-after-item work.
   * `single` calls `onComplete` after the first successful code, for filling
   * one field; a code that fails leaves the scanner open to try again.
   */
  mode?: 'continuous' | 'single';
  onComplete?: () => void;
  /** Rendered beside the status, e.g. a dialog title. */
  title?: React.ReactNode;
  /** Shows a Done button that calls this. */
  onDone?: () => void;
  doneLabel?: string;
  /** Running total shown in the feedback line, worded by the screen. */
  countLabel?: (count: number) => string;
  /** A field to type a code by hand, for labels the camera can't read. */
  manualEntry?: boolean;
  /** See scan-gate.ts for how these two work together. */
  sameCodeCooldownMs?: number;
  sameCodeReleaseMs?: number;
  /**
   * Keeps the preview live but stops decoding — e.g. while the cashier types
   * a quantity, so a pack still under the camera can't add one more.
   */
  holdDecoding?: boolean;
  holdLabel?: string;
  /** The screen's own content under the result line, e.g. the cart. */
  children?: React.ReactNode;
  /** Preview shape; defaults to 4:3. */
  previewClassName?: string;
  className?: string;
}

/**
 * Mount it only while scanning should happen: unmounting releases the camera
 * and resets every lock and timer with it.
 */
export function ScannerPanel({
  onBarcodeDetected,
  onScanError,
  onScannerReady,
  onScannerStopped,
  mode = 'continuous',
  onComplete,
  title,
  onDone,
  doneLabel = 'Done',
  countLabel,
  manualEntry = false,
  sameCodeCooldownMs = 1500,
  sameCodeReleaseMs = 900,
  holdDecoding = false,
  holdLabel = 'Scanning on hold',
  children,
  previewClassName = 'aspect-[4/3]',
  className,
}: ScannerPanelProps) {
  const [camera, setCamera] = React.useState<CameraState>(() => supportFailure() ?? 'starting');
  const [paused, setPaused] = React.useState(false);
  // Bumped to restart the camera from scratch (Start, Try again).
  const [session, setSession] = React.useState(0);
  const [cameras, setCameras] = React.useState<{ deviceId: string; label: string }[]>([]);
  const [requestedDeviceId, setRequestedDeviceId] = React.useState<string | undefined>();
  const [activeDeviceId, setActiveDeviceId] = React.useState<string | undefined>();
  const [sound, setSound] = React.useState(readSoundPreference);
  const [feedback, setFeedback] = React.useState<Feedback>({ status: 'idle' });
  const [flash, setFlash] = React.useState<'ok' | 'bad' | null>(null);
  const [successCount, setSuccessCount] = React.useState(0);
  const [typed, setTyped] = React.useState('');

  // Callbacks are read through a ref so a screen re-rendering with new
  // closures never restarts the camera or the keyboard listener.
  const handlers = React.useRef({ onBarcodeDetected, onScanError, onScannerReady, onScannerStopped, onComplete });
  React.useEffect(() => {
    handlers.current = { onBarcodeDetected, onScanError, onScannerReady, onScannerStopped, onComplete };
  });
  const soundRef = React.useRef(sound);
  React.useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  const modeRef = React.useRef(mode);
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // One lookup at a time: a camera read arriving mid-request is dropped (it
  // will be read again a frame later), so overlapping requests can never act
  // on the same code twice. Keyboard codes are deliberate and queue instead.
  const busyRef = React.useRef(false);
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());
  const lastRef = React.useRef<LastRead | null>(null);
  // Once a single-mode scan has succeeded, nothing else may get through.
  const finishedRef = React.useRef(false);

  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const signal = React.useCallback((ok: boolean) => {
    setFlash(ok ? 'ok' : 'bad');
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 450);
    if (soundRef.current) beep(ok ? 'ok' : 'error');
    vibrate(ok ? 40 : [60, 50, 60]);
  }, []);

  /** Hands one code to the screen and shows what it said. */
  const handle = React.useCallback(
    async (code: string, source: ScanSource) => {
      if (finishedRef.current) return;
      setFeedback({ status: 'looking', code });

      let result: ScanFeedback;
      try {
        result = await handlers.current.onBarcodeDetected(code, source);
      } catch {
        result = { tone: 'error', title: 'Could not look up that barcode. Check the connection.' };
      }

      setFeedback({ status: 'done', code, result });
      const ok = result.tone === 'success';
      if (ok) setSuccessCount((count) => count + 1);
      signal(ok);

      if (ok && modeRef.current === 'single') {
        finishedRef.current = true;
        handlers.current.onComplete?.();
      }
    },
    [signal],
  );

  const handleCameraRead = React.useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!PLAUSIBLE_CODE.test(code)) return;

      const now = performance.now();
      const timing = { cooldownMs: sameCodeCooldownMs, releaseMs: sameCodeReleaseMs };
      if (!admitRead(lastRef.current, code, now, timing)) return;
      if (busyRef.current) return;

      busyRef.current = true;
      lastRef.current = { code, acceptedAt: now, seenAt: now };
      try {
        await handle(code, 'camera');
      } finally {
        busyRef.current = false;
        // Measure the "left view" gap from when the lookup finished, not from
        // when it began, so a slow request can't open the gate early.
        if (lastRef.current?.code === code) lastRef.current.seenAt = performance.now();
      }
    },
    [sameCodeCooldownMs, sameCodeReleaseMs, handle],
  );

  /** Typed or wedge-scanned codes: deliberate, so queued and never gated. */
  const submitTyped = React.useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!PLAUSIBLE_CODE.test(code)) return false;
      queueRef.current = queueRef.current.then(() => handle(code, 'keyboard'));
      return true;
    },
    [handle],
  );

  // A USB/Bluetooth scanner is a keyboard. While a scanner is open the
  // screen's own scanner field is usually out of reach, and the scanner's
  // closing Enter would otherwise "press" whichever button has focus — Stop,
  // say. A fast burst of keys ending in Enter is taken as a scan instead;
  // ordinary typing and a person pressing Enter on a button are left alone.
  React.useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // The manual field submits itself.
      if ((event.target as HTMLElement | null)?.dataset?.scannerManual !== undefined) return;

      const now = performance.now();
      if (now - lastKeyAt > WEDGE_KEY_GAP_MS) buffer = '';
      lastKeyAt = now;

      if (event.key === 'Enter') {
        const code = buffer.trim();
        buffer = '';
        if (code.length >= WEDGE_MIN_LENGTH && submitTyped(code)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [submitTyped]);

  const refreshCameras = React.useCallback(async () => {
    setCameras(await listCameras());
  }, []);

  React.useEffect(() => {
    const devices = navigator.mediaDevices;
    if (typeof devices?.addEventListener !== 'function') return;
    const onChange = () => void refreshCameras();
    devices.addEventListener('devicechange', onChange);
    return () => devices.removeEventListener('devicechange', onChange);
  }, [refreshCameras]);

  // Whether a camera is held, so "stopped" fires once per release — on Stop,
  // on a failure, or when the panel goes away.
  const holdingRef = React.useRef(false);
  const released = React.useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    handlers.current.onScannerStopped?.();
  }, []);
  React.useEffect(() => released, [released]);

  const handleReady = React.useCallback(
    ({ deviceId }: { deviceId?: string }) => {
      holdingRef.current = true;
      setActiveDeviceId(deviceId);
      setCamera('scanning');
      handlers.current.onScannerReady?.();
      // Labels only appear once permission is granted, i.e. now.
      void refreshCameras();
    },
    [refreshCameras],
  );

  const handleFailed = React.useCallback(
    (state: CameraFailure) => {
      released();
      setCamera(state);
      handlers.current.onScanError?.(state);
    },
    [released],
  );

  // A browser that can't scan at all is a failure from the first render.
  React.useEffect(() => {
    const failure = supportFailure();
    if (failure) handlers.current.onScanError?.(failure);
  }, []);

  const startCamera = (deviceId = requestedDeviceId) => {
    primeAudio();
    setRequestedDeviceId(deviceId);
    setPaused(false);
    setSession((value) => value + 1);
    setCamera(supportFailure() ?? 'starting');
  };

  const stopCamera = () => {
    setPaused(false);
    setCamera('off');
    released();
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    writeSoundPreference(next);
    if (next) primeAudio();
  };

  const cameraLive = camera === 'starting' || camera === 'scanning';
  const failure: CameraFailure | null = cameraLive || camera === 'off' ? null : camera;

  return (
    <div className={cn('grid gap-3', className)}>
      {title !== undefined && (
        <div className="flex items-center gap-2.5 pr-6">
          {title}
          <StatusPill camera={camera} paused={paused} />
        </div>
      )}

      {failure ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <ScannerError state={failure} />
          {isRetryable(failure) || requestedDeviceId ? (
            <Button
              type="button"
              className="w-full"
              // A camera picked from the list that has since gone away should
              // not keep failing — fall back to the default one.
              onClick={() => startCamera(failure === 'no-camera' ? undefined : requestedDeviceId)}
            >
              Try again
            </Button>
          ) : null}
          <p className="text-center text-xs text-muted-foreground">
            You can still type the barcode or use a USB scanner.
          </p>
        </div>
      ) : (
        <div className={cn('relative w-full overflow-hidden rounded-xl bg-black', previewClassName)}>
          {cameraLive && (
            <CameraStage
              key={`${session}:${requestedDeviceId ?? 'default'}`}
              paused={paused}
              holdDecoding={holdDecoding}
              deviceId={requestedDeviceId}
              onReady={handleReady}
              onFailed={handleFailed}
              onDetected={(code) => void handleCameraRead(code)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}

          {camera === 'scanning' && (
            <AimingOverlay
              hold={paused ? 'Paused' : holdDecoding ? holdLabel : null}
              flash={flash}
            />
          )}

          {camera === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-white/75">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p className="text-sm">Starting camera…</p>
              <p className="text-xs text-white/55">Allow camera access if your browser asks.</p>
            </div>
          )}

          {camera === 'off' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white/75">
              <CameraOff className="h-7 w-7" aria-hidden="true" />
              <p className="text-sm">The camera is off.</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => startCamera()}>
                <Power /> Start scanner
              </Button>
            </div>
          )}
        </div>
      )}

      <FeedbackLine feedback={feedback} count={successCount} countLabel={countLabel} />

      {children}

      {manualEntry && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            // React bubbles submit through portals, so without this a scanner
            // opened from inside a form would submit that form too.
            event.stopPropagation();
            if (submitTyped(typed)) setTyped('');
          }}
        >
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Or type a barcode"
            className="h-11 font-mono"
            inputMode="text"
            autoComplete="off"
            aria-label="Type a barcode"
            data-scanner-manual=""
            maxLength={64}
          />
          <Button type="submit" variant="outline" className="h-11 shrink-0" disabled={!typed.trim()}>
            <CornerDownLeft /> Enter
          </Button>
        </form>
      )}

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={camera !== 'scanning'}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? (
            <>
              <Play /> Resume
            </>
          ) : (
            <>
              <Pause /> Pause
            </>
          )}
        </Button>
        {cameraLive ? (
          <Button type="button" variant="outline" className="h-11" onClick={stopCamera}>
            <CameraOff /> Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={failure !== null && !isRetryable(failure)}
            onClick={() => startCamera()}
          >
            <Power /> Start
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-pressed={sound}
          aria-label={sound ? 'Turn scan sound off' : 'Turn scan sound on'}
          title={sound ? 'Sound on' : 'Sound off'}
          onClick={toggleSound}
        >
          {sound ? <Volume2 /> : <VolumeX />}
        </Button>
      </div>

      {cameras.length > 1 && (
        <Select
          value={activeDeviceId ?? requestedDeviceId ?? ''}
          onValueChange={(id) => {
            if (id && id !== activeDeviceId) startCamera(id);
          }}
        >
          <SelectTrigger className="h-11" aria-label="Camera">
            <SelectValue placeholder="Choose a camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {onDone && (
        <Button type="button" className="h-11 w-full" onClick={onDone}>
          {doneLabel}
        </Button>
      )}
    </div>
  );
}

// --- Pieces ---------------------------------------------------------------

function StatusPill({ camera, paused }: { camera: CameraState; paused: boolean }) {
  const [label, dot] =
    camera === 'scanning'
      ? paused
        ? ['Paused', 'bg-warning']
        : ['Scanning', 'bg-red-500 animate-pulse']
      : camera === 'starting'
        ? ['Starting', 'bg-muted-foreground animate-pulse']
        : camera === 'off'
          ? ['Off', 'bg-muted-foreground']
          : ['Error', 'bg-destructive'];

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * The scanning window over the live preview: a clear frame with the rest of
 * the picture dimmed, corner guides, and the sweeping red line.
 *
 * Everything here is `pointer-events-none` and sits above the <video> without
 * touching it — the stream and the decoder see the camera image untouched.
 */
function AimingOverlay({ hold, flash }: { hold: string | null; flash: 'ok' | 'bad' | null }) {
  const corner = cn(
    'absolute h-6 w-6 transition-colors duration-150',
    flash === 'ok' ? 'border-success' : flash === 'bad' ? 'border-destructive' : 'border-white/90',
  );

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div
        className={cn(
          'absolute inset-x-[8%] top-1/2 h-[48%] -translate-y-1/2 rounded-lg',
          // A huge spread shadow dims everything outside the window; the
          // viewport's overflow-hidden clips it to the preview.
          'shadow-[0_0_0_100vmax_rgb(0_0_0/0.4)]',
          'ring-2 ring-inset transition-[box-shadow] duration-150',
          flash === 'ok' ? 'ring-success/80' : flash === 'bad' ? 'ring-destructive/80' : 'ring-transparent',
        )}
      >
        <span className={cn(corner, '-left-0.5 -top-0.5 rounded-tl-lg border-l-[3px] border-t-[3px]')} />
        <span className={cn(corner, '-right-0.5 -top-0.5 rounded-tr-lg border-r-[3px] border-t-[3px]')} />
        <span className={cn(corner, '-bottom-0.5 -left-0.5 rounded-bl-lg border-b-[3px] border-l-[3px]')} />
        <span className={cn(corner, '-bottom-0.5 -right-0.5 rounded-br-lg border-b-[3px] border-r-[3px]')} />

        {hold ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
              <Pause className="h-3.5 w-3.5" /> {hold}
            </span>
          </div>
        ) : (
          // A full-height track carries the line, so the sweep is a transform
          // only. With reduced motion it holds still across the middle.
          <div className="absolute inset-x-2 inset-y-0 animate-scan-line motion-reduce:translate-y-1/2 motion-reduce:animate-none">
            <div
              className={cn(
                'h-0.5 w-full rounded-full',
                'bg-[linear-gradient(90deg,transparent,rgb(255_45_45)_14%,rgb(255_45_45)_86%,transparent)]',
                'shadow-[0_0_6px_1px_rgb(255_40_40/0.7),0_0_16px_4px_rgb(255_40_40/0.3)]',
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const TONE_ICON: Record<ScanFeedback['tone'], React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
};

function FeedbackLine({
  feedback,
  count,
  countLabel,
}: {
  feedback: Feedback;
  count: number;
  countLabel?: (count: number) => string;
}) {
  let icon: React.ReactNode;
  let title: React.ReactNode;
  let detail: string | undefined;

  if (feedback.status === 'idle') {
    icon = <ScanLine className="h-4 w-4 text-muted-foreground" />;
    title = <span className="text-muted-foreground">Position the barcode inside the frame.</span>;
  } else if (feedback.status === 'looking') {
    icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    title = 'Looking up…';
    detail = feedback.code;
  } else {
    const { result, code } = feedback;
    detail = code;
    icon = TONE_ICON[result.tone];
    title = (
      <>
        <span className="truncate">{result.title}</span>
        {result.meta && <span className="shrink-0 tabular text-muted-foreground">{result.meta}</span>}
      </>
    );
  }

  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">{title}</p>
        {detail && <p className="truncate font-mono text-xs text-muted-foreground">{detail}</p>}
      </div>
      {count > 0 && countLabel && (
        <span className="shrink-0 text-xs text-muted-foreground tabular">{countLabel(count)}</span>
      )}
    </div>
  );
}
