'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { promptInstall, useInstallPlatform, useInstallState } from '@/features/pwa/install-state';
import type { InstallPlatform } from '@/lib/pwa';

type GuidedPlatform = Exclude<InstallPlatform, 'other'>;

const GUIDES: Record<GuidedPlatform, { label: string; steps: string[] }> = {
  ios: {
    label: 'iPhone and iPad',
    steps: [
      'Open this page in Safari (on iOS 16.4 or later, Chrome and Edge work too).',
      'Tap the Share button: the square with an arrow pointing up.',
      'Scroll down, tap Add to Home Screen, then tap Add.',
      'Open TindahanProMax from the new icon and sign in once inside the app.',
    ],
  },
  android: {
    label: 'Android phones and tablets',
    steps: [
      'Open this page in Chrome, Edge or Samsung Internet.',
      'Tap the ⋮ menu, then Install app (or Add to Home screen).',
      'Tap Install. The icon appears on your home screen and in the app drawer.',
    ],
  },
  'desktop-chromium': {
    label: 'Windows, Mac and Chromebook (Chrome or Edge)',
    steps: [
      'Click the install icon at the right end of the address bar.',
      'Or use the menu. Chrome: Cast, save and share → Install page as app. Edge: Apps → Install this site as an app.',
      'TindahanProMax opens in its own window, which you can pin to the taskbar or Dock.',
    ],
  },
  'desktop-safari': {
    label: 'Mac (Safari 17 or later)',
    steps: ['Choose File → Add to Dock.', 'Click Add. TindahanProMax opens from the Dock in its own window.'],
  },
  'desktop-firefox': {
    label: 'Firefox on a computer',
    steps: ['Firefox on Windows, Mac and Linux cannot install web apps. Open this page in Chrome or Edge instead.'],
  },
};

function Guide({ platform }: { platform: GuidedPlatform }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm">
      {GUIDES[platform].steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

/**
 * Install help. Where the browser offers its own prompt (Chrome, Edge,
 * Android) the primary button opens it; everywhere else, and as a fallback,
 * it shows the steps for this device with the others one tap away.
 */
export function InstallAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const platform = useInstallPlatform();
  const state = useInstallState();
  const [prompting, setPrompting] = React.useState(false);

  const guided = platform && platform !== 'other' ? platform : null;
  const others = (Object.keys(GUIDES) as GuidedPlatform[]).filter((key) => key !== guided);

  const install = async () => {
    setPrompting(true);
    const outcome = await promptInstall();
    setPrompting(false);
    if (outcome === 'accepted') {
      toast.success('TindahanProMax is being installed.');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Install TindahanProMax</DialogTitle>
          <DialogDescription>
            Open the POS from its own icon, full screen and without the browser&apos;s address bar.
          </DialogDescription>
        </DialogHeader>

        {state?.installed ? (
          <p className="text-sm">TindahanProMax is already installed on this device.</p>
        ) : (
          <div className="space-y-4">
            {state?.canPrompt && (
              <Button className="h-11 w-full" onClick={install} loading={prompting}>
                <Download /> Install app
              </Button>
            )}

            {guided && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {state?.canPrompt ? 'Or install it yourself' : `On this device: ${GUIDES[guided].label}`}
                </h3>
                <Guide platform={guided} />
              </section>
            )}

            <details className="rounded-lg border px-3 py-2" open={!guided}>
              <summary className="cursor-pointer py-1 text-sm font-medium">
                {guided ? 'Other devices' : 'Choose your device'}
              </summary>
              <div className="space-y-3 pb-1 pt-2">
                {others.map((key) => (
                  <section key={key} className="space-y-1.5">
                    <h4 className="text-sm font-semibold">{GUIDES[key].label}</h4>
                    <Guide platform={key} />
                  </section>
                ))}
              </div>
            </details>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          The installed app needs an internet connection to record sales, like the website.
        </p>
      </DialogContent>
    </Dialog>
  );
}
