'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

/** Toast surface. Follows the app theme so it never flashes white in dark mode. */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={(resolvedTheme as 'light' | 'dark' | undefined) ?? 'system'}
      position="top-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'group border-border bg-background text-foreground shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
