'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FormError, FormField } from '@/components/form';
import { PIN_HINT, PIN_MAX_LENGTH, pinProblem } from '@/lib/pos-pin';
import { removeOwnPosPin, setOwnPosPin } from '@/features/auth/lock-actions';

/**
 * Sets or removes the caller's own screen-lock PIN. Both need the current
 * password, so someone who walks up to an unlocked screen cannot plant a PIN
 * they know.
 */
export function PosPinForm({ hasPin }: { hasPin: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = React.useState<'set' | 'remove' | null>(null);

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);

  const reset = () => {
    setCurrentPassword('');
    setPin('');
    setConfirmPin('');
    setFieldErrors({});
  };

  const onSet = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const problem = pinProblem(pin);
    const errors: Record<string, string | undefined> = {
      currentPassword: currentPassword ? undefined : 'Enter your current password.',
      pin: problem ?? undefined,
      confirmPin: confirmPin === pin ? undefined : 'The PINs do not match.',
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setBusy('set');
    const result = await setOwnPosPin({ currentPassword, pin });
    setBusy(null);

    if (!result.ok) {
      setFormError(result.error);
      setFieldErrors({ currentPassword: result.fieldErrors?.currentPassword?.[0], pin: result.fieldErrors?.pin?.[0] });
      return;
    }
    toast.success(hasPin ? 'PIN changed.' : 'PIN set. Use it to unlock the screen.');
    reset();
    router.refresh();
  };

  const onRemove = async () => {
    setFormError(null);
    if (!currentPassword) {
      setFieldErrors({ currentPassword: 'Enter your current password to remove the PIN.' });
      return;
    }
    setBusy('remove');
    const result = await removeOwnPosPin({ currentPassword });
    setBusy(null);

    if (!result.ok) {
      setFormError(result.error);
      setFieldErrors({ currentPassword: result.fieldErrors?.currentPassword?.[0] });
      return;
    }
    toast.success('PIN removed. The lock screen will ask for your password.');
    reset();
    router.refresh();
  };

  return (
    <form onSubmit={onSet} className="space-y-4" noValidate>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Badge variant={hasPin ? 'success' : 'secondary'}>{hasPin ? 'PIN set' : 'No PIN — password unlocks'}</Badge>
      </div>

      <FormError message={formError} />

      <FormField
        id="pin-current-password"
        label="Current password"
        required
        error={fieldErrors.currentPassword}
      >
        <Input
          id="pin-current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pin-new" label={hasPin ? 'New PIN' : 'PIN'} description={PIN_HINT} error={fieldErrors.pin}>
          <Input
            id="pin-new"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            className="font-mono tracking-widest"
            value={pin}
            onChange={(e) => setPin(digitsOnly(e.target.value))}
          />
        </FormField>
        <FormField id="pin-confirm" label="Confirm PIN" error={fieldErrors.confirmPin}>
          <Input
            id="pin-confirm"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            className="font-mono tracking-widest"
            value={confirmPin}
            onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {hasPin && (
          <Button type="button" variant="outline" onClick={onRemove} loading={busy === 'remove'} disabled={busy !== null}>
            Remove PIN
          </Button>
        )}
        <Button type="submit" loading={busy === 'set'} disabled={busy !== null}>
          {hasPin ? 'Change PIN' : 'Set PIN'}
        </Button>
      </div>
    </form>
  );
}
