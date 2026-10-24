'use client';

import * as React from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { passwordChangeProblems, type PasswordChangeProblems } from '@/lib/password-change';
import { changeTemporaryPassword } from '@/features/auth/password-change-actions';
import { SignOutDialog } from '@/features/auth/sign-out';
import { PasswordChecklist, PasswordInput } from '@/components/password-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';

/**
 * The mandatory first-sign-in password change. The checks here are a
 * courtesy; the server action repeats every one of them and verifies the
 * temporary password against the stored hash.
 */
export function ChangePasswordView({ name, username }: { name: string; username: string }) {
  const [values, setValues] = React.useState<Record<Field, string>>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = React.useState<PasswordChangeProblems>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [signOutOpen, setSignOutOpen] = React.useState(false);

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || done) return;

    const problems = passwordChangeProblems(values);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }

    setBusy(true);
    const result = await changeTemporaryPassword(values);
    if (!result.ok) {
      setBusy(false);
      const fieldErrors = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).map(([field, messages]) => [field, messages[0]]),
      ) as PasswordChangeProblems;
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
      return;
    }

    setDone(true);
    // The passwords leave memory with the component; a full navigation also
    // makes every server check re-read the cleared requirement.
    setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
    toast.success('Password updated.');
    window.location.assign('/dashboard');
  };


  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-card border bg-card p-6 shadow-card sm:p-8">
        <div className="space-y-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-title">Change your temporary password</h1>
            <p className="text-sm text-muted-foreground">For your security, set a new password before continuing.</p>
            <p className="text-xs text-muted-foreground">
              Signed in as {name} · <span className="font-mono">@{username}</span>
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <PasswordField
            id="current-password"
            label="Temporary password"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={set('currentPassword')}
            error={errors.currentPassword}
            autoFocus
          />

          <div className="space-y-2">
            <PasswordField
              id="new-password"
              label="New password"
              autoComplete="new-password"
              value={values.newPassword}
              onChange={set('newPassword')}
              error={errors.newPassword}
              describedBy="new-password-rules"
            />
            <PasswordChecklist id="new-password-rules" password={values.newPassword} />
          </div>

          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={set('confirmPassword')}
            error={errors.confirmPassword}
          />

          {formError && (
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
              {formError}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={busy || done}>
            {done ? 'Password updated — continuing…' : 'Update Password & Continue'}
          </Button>
        </form>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            disabled={busy || done}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
          </button>
        </div>
        <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
      </div>
    </main>
  );
}

function PasswordField({
  id,
  label,
  error,
  describedBy,
  ...props
}: {
  id: string;
  label: string;
  error?: string;
  describedBy?: string;
} & Omit<React.ComponentProps<typeof PasswordInput>, 'id'>) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <PasswordInput
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
