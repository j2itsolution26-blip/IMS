'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function ThemeToggle({ variant = 'dropdown' }: { variant?: 'dropdown' | 'segmented' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (variant === 'segmented') {
    if (!mounted) {
      return (
        <div className="flex h-9 w-full items-center justify-between rounded-lg bg-muted/60 p-1">
          <div className="h-7 w-full rounded-md bg-background/50 animate-pulse" />
        </div>
      );
    }

    const options = [
      { id: 'light', label: 'Light', icon: Sun },
      { id: 'system', label: 'System', icon: Monitor },
      { id: 'dark', label: 'Dark', icon: Moon },
    ] as const;

    return (
      <div
        role="radiogroup"
        aria-label="Theme selection"
        className="flex h-9 w-full items-center rounded-lg bg-muted/70 p-1 text-muted-foreground"
      >
        {options.map(({ id, label, icon: Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all duration-150',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:text-foreground hover:bg-background/40',
              )}
              title={`${label} theme`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {!mounted ? (
            <Monitor className="h-4 w-4" />
          ) : theme === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : theme === 'light' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Monitor className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="h-4 w-4 mr-2" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="h-4 w-4 mr-2" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="h-4 w-4 mr-2" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
