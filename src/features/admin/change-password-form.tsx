'use client';

import * as React from 'react';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { validatePassword } from '@/lib/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/form';
import { cn } from '@/lib/utils';

/**
 * Self-service password change.
 *
 * Uses Better Auth's own `/change-password` endpoint (via the client SDK),
 * so this goes through the exact same hashing and session machinery as
 * sign-in and the owner-setup form — nothing about how credentials are
 * stored is reinvented here.
 */
export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const analysis = React.useMemo(() => validatePassword(newPassword), [newPassword]);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;
  const isFormValid =
    currentPassword.length > 0 && analysis.isValid && passwordsMatch && newPassword !== currentPassword;

  const requirements = [
    { id: 'length', label: 'At least 10 characters', met: analysis.minLength },
    { id: 'upper', label: 'One uppercase letter', met: analysis.uppercase },
    { id: 'lower', label: 'One lowercase letter', met: analysis.lowercase },
    { id: 'number', label: 'One number', met: analysis.number },
    { id: 'special', label: 'One special character', met: analysis.specialCharacter },
  ];

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!isFormValid) return;

    setSubmitting(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setSubmitting(false);

    if (error) {
      const message = error.message || 'Could not change your password. Please try again.';
      setFormError(message);
      toast.error('Unable to change password', { description: message });
      return;
    }

    toast.success('Password changed', {
      description: 'You have been signed out of your other sessions.',
    });
    reset();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />

      <PasswordField
        id="current-password"
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        show={showCurrent}
        onToggleShow={() => setShowCurrent((v) => !v)}
        autoComplete="current-password"
        disabled={submitting}
      />

      <PasswordField
        id="new-password"
        label="New password"
        value={newPassword}
        onChange={setNewPassword}
        show={showNew}
        onToggleShow={() => setShowNew((v) => !v)}
        autoComplete="new-password"
        disabled={submitting}
        invalid={newPassword.length > 0 && !analysis.isValid}
      />

      {newPassword.length > 0 && (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-semibold text-muted-foreground">Password requirements:</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-xs">
            {requirements.map((req) => (
              <li
                key={req.id}
                className={cn(
                  'flex items-center gap-1.5',
                  req.met ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                )}
              >
                {req.met ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                )}
                <span>{req.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PasswordField
        id="confirm-new-password"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        show={showConfirm}
        onToggleShow={() => setShowConfirm((v) => !v)}
        autoComplete="new-password"
        disabled={submitting}
        invalid={confirmPassword.length > 0 && !passwordsMatch}
        description={
          confirmPassword.length > 0 && !passwordsMatch ? 'Passwords do not match.' : undefined
        }
      />

      <div className="flex justify-end">
        <Button type="submit" loading={submitting} disabled={!isFormValid}>
          Change password
        </Button>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  disabled,
  invalid,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  disabled?: boolean;
  invalid?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggleShow}
          disabled={disabled}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {description && <p className="text-xs text-destructive">{description}</p>}
    </div>
  );
}
