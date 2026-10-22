'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { InstallAppDialog } from '@/features/pwa/install-app-dialog';
import { useInstallState } from '@/features/pwa/install-state';

/** Quiet "install" link for the sign-in screen; hidden inside the installed app. */
export function InstallAppLink() {
  const state = useInstallState();
  const [open, setOpen] = React.useState(false);

  if (!state || state.installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Install the app on this device
      </button>
      <InstallAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
