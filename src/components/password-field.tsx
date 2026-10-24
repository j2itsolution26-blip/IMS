'use client';

import * as React from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { validatePassword } from '@/lib/password';
import { cn } from '@/lib/utils';

/**
 * A password input with a show/hide button inside it. Hidden by default;
 * `revealed` lets a parent show it (after generating one, for instance).
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, 'type'> & {
    revealed?: boolean;
    onRevealedChange?: (revealed: boolean) => void;
  }
>(({ revealed, onRevealedChange, className, id, ...props }, ref) => {
  const [ownRevealed, setOwnRevealed] = React.useState(false);
  const shown = revealed ?? ownRevealed;
  const toggle = () => {
    const next = !shown;
    if (onRevealedChange) onRevealedChange(next);
    if (revealed === undefined) setOwnRevealed(next);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={ref}
        id={id}
        type={shown ? 'text' : 'password'}
        autoCapitalize="none"
        spellCheck={false}
        className={cn('pr-10', shown && 'font-mono', className)}
        {...props}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={id}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

const RULES = [
  { key: 'minLength', label: 'At least 10 characters' },
  { key: 'uppercase', label: 'An uppercase letter' },
  { key: 'lowercase', label: 'A lowercase letter' },
  { key: 'number', label: 'A number' },
  { key: 'specialCharacter', label: 'A symbol' },
] as const;

/**
 * The password policy as a live checklist. Driven by `validatePassword` — the
 * same function the server enforces — so the list cannot drift from the rules.
 */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  const result = validatePassword(password);
  return (
    <ul id={id} className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {RULES.map((rule) => {
        const met = result[rule.key];
        return (
          <li
            key={rule.key}
            className={cn('flex items-center gap-1.5', met ? 'text-success-text' : 'text-muted-foreground')}
          >
            {met ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {rule.label}
              <span className="sr-only">{met ? ' — met' : ' — not met yet'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
