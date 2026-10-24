'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', label: 'Light', hint: 'Bright surfaces, dark text', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Easier on the eyes at night', icon: Moon },
  { value: 'system', label: 'System', hint: "Matches this device's setting", icon: Monitor },
] as const;

/**
 * The application's one theme control (header, and the sign-in screens).
 * State lives in next-themes, which persists the choice and follows the
 * device's preference in System mode; there is no second control to drift
 * out of step with it.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Until mounted the stored choice is unknown, so the icon stays neutral
  // rather than flashing the wrong one.
  const current = mounted ? (OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2]) : OPTIONS[2];
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:text-foreground"
          aria-label={mounted ? `Appearance: ${current.label}. Change appearance` : 'Change appearance'}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)] p-1.5 shadow-lg">
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5">Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-0 bg-border" />
        <DropdownMenuRadioGroup value={mounted ? (theme ?? 'system') : undefined} onValueChange={setTheme}>
          {OPTIONS.map(({ value, label, hint, icon: OptionIcon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              // Radix's own dot indicator is replaced by the check on the right.
              className="group gap-3 py-2 pl-2 pr-2 [&>span:first-child]:hidden data-[state=checked]:bg-primary/5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground group-data-[state=checked]:bg-primary/10 group-data-[state=checked]:text-primary">
                <OptionIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{hint}</span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-primary opacity-0 group-data-[state=checked]:opacity-100" aria-hidden="true" />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
