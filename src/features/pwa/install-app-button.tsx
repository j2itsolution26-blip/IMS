'use client';

import * as React from 'react';
import { TabletSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InstallAppDialog } from '@/features/pwa/install-app-dialog';
import { useInstallPlatform, useInstallState } from '@/features/pwa/install-state';
import { installActionAvailable } from '@/lib/pwa';

/**
 * "Install on phone or tablet", in the top bar on every page: opens the
 * install help (or the browser's own install prompt). Hidden once the app is
 * installed, and where the browser cannot install it.
 */
export function InstallAppButton() {
  const canInstall = installActionAvailable(useInstallState(), useInstallPlatform());
  const [open, setOpen] = React.useState(false);
  if (!canInstall) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label="Install on phone or tablet"
        title="Install on phone or tablet"
      >
        <TabletSmartphone className="h-5 w-5" />
      </Button>
      <InstallAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
