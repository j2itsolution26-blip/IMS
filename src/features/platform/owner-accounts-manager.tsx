'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound, ShieldCheck, ShieldX, Store, UserPlus, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformAccount } from '@/features/platform/queries';
import { createOwnerAccount, resetOwnerPassword, setOwnerActive } from '@/features/platform/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { USERNAME_HINT } from '@/lib/username';
import { generatePassword } from '@/lib/password';

/** Longer than the 10-character minimum: a generated password is never typed from memory. */
const GENERATED_PASSWORD_LENGTH = 16;

type Dialogs = { kind: 'create' } | { kind: 'reset' | 'toggle'; account: PlatformAccount } | null;

/**
 * Owner account administration.
 *
 * Every button here calls a server action that re-checks `platform.manage`;
 * what this component decides is only what to show.
 */
export function OwnerAccountsManager({
  accounts,
  storesAwaitingOwner,
}: {
  accounts: PlatformAccount[];
  /** Stores with no owner yet; the new owner goes to the oldest of them. */
  storesAwaitingOwner: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const [busy, setBusy] = React.useState(false);

  const [form, setForm] = React.useState({ name: '', username: '', email: '', password: '', phone: '' });
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  // Whether the field holds a freshly generated password, or generation failed.
  const [generation, setGeneration] = React.useState<'idle' | 'generated' | 'failed'>('idle');

  const close = () => {
    setDialog(null);
    setForm({ name: '', username: '', email: '', password: '', phone: '' });
    setPassword('');
    setShowPassword(false);
    setGeneration('idle');
  };

  const onGeneratePassword = () => {
    try {
      // Web Crypto only (see generatePassword). If it is unavailable this
      // throws, and the field is left as it was rather than filled from an
      // insecure source.
      const generated = generatePassword(GENERATED_PASSWORD_LENGTH);
      setForm((current) => ({ ...current, password: generated }));
      // Revealed so the admin can pass it on; the eye button hides it again.
      setShowPassword(true);
      setGeneration('generated');
    } catch {
      setGeneration('failed');
    }
  };

  const onCreate = async () => {
    setBusy(true);
    const result = await createOwnerAccount(form);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Owner account created. They can sign in now.');
    close();
    router.refresh();
  };

  const onReset = async () => {
    if (dialog?.kind !== 'reset') return;
    setBusy(true);
    const result = await resetOwnerPassword(dialog.account.id, { password });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Password reset. ${dialog.account.name} must sign in again.`);
    close();
    router.refresh();
  };

  const onToggle = async () => {
    if (dialog?.kind !== 'toggle') return;
    const next = !dialog.account.isActive;
    setBusy(true);
    const result = await setOwnerActive(dialog.account.id, next);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(next ? 'Owner reactivated.' : 'Owner deactivated. Their sessions were ended.');
    close();
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {accounts.length === 0
            ? 'No owner account yet.'
            : `${accounts.length} owner account${accounts.length === 1 ? '' : 's'}.`}
        </p>
        {storesAwaitingOwner > 0 && accounts.length > 0 && (
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <UserPlus /> Create owner
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-card border bg-card shadow-card">
        {accounts.length === 0 && storesAwaitingOwner === 0 ? (
          // An owner belongs to a store, and with no store waiting for one the
          // server would refuse the form — so point to where owners are made.
          <EmptyState
            icon={Store}
            title="No stores yet"
            description="Each owner is set up together with their store. Create a store to add its owner."
            action={
              <Button asChild>
                <Link href="/system-admin/stores">
                  <Store /> Go to Stores
                </Link>
              </Button>
            }
          />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No owner account"
            description="Create the store owner so they can sign in and run the shop."
            action={<Button onClick={() => setDialog({ kind: 'create' })}>Create owner</Button>}
          />
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">Owner</TableHead>
                <TableHead scope="col">Email</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col">Last login</TableHead>
                <TableHead scope="col" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      @{account.username} · {account.roleName}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{account.email}</TableCell>
                  <TableCell>
                    <Badge variant={account.isActive ? 'success' : 'destructive'}>
                      {account.isActive ? 'Active' : 'Deactivated'}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(account.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDialog({ kind: 'reset', account })}
                      >
                        <KeyRound /> Reset password
                      </Button>
                      <Button
                        variant={account.isActive ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => setDialog({ kind: 'toggle', account })}
                      >
                        {account.isActive ? <ShieldX /> : <ShieldCheck />}
                        {account.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create */}
      <Dialog open={dialog?.kind === 'create'} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create owner account</DialogTitle>
            <DialogDescription>
              The owner runs the store: products, stock, the till and staff accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="owner-name">Full name</Label>
              <Input
                id="owner-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-username">Username</Label>
              <Input
                id="owner-username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {USERNAME_HINT} The owner can sign in with this or their email.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-email">Email address</Label>
              <Input
                id="owner-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-phone">Contact number (optional)</Label>
              <Input
                id="owner-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-password">Temporary password</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Input
                    id="owner-password"
                    type={showPassword ? 'text' : 'password'}
                    // Stops the browser filling in the admin's own saved password.
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="pr-10 font-mono"
                    aria-describedby="owner-password-hint owner-password-status"
                    value={form.password}
                    onChange={(e) => {
                      setForm({ ...form, password: e.target.value });
                      setGeneration('idle');
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    aria-controls="owner-password"
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <Button type="button" variant="outline" className="shrink-0" onClick={onGeneratePassword} disabled={busy}>
                  <Wand2 /> Generate
                </Button>
              </div>
              <p id="owner-password-hint" className="text-xs text-muted-foreground">
                At least 10 characters with upper and lower case, a number and a symbol. The owner must
                change it when signing in for the first time.
              </p>
              {/* Announces the outcome, never the password itself. */}
              <p id="owner-password-status" role="status" aria-live="polite" className="text-xs font-medium">
                {generation === 'generated' && (
                  <span className="text-success-text">
                    New password generated. Copy it for the owner before you create the account.
                  </span>
                )}
                {generation === 'failed' && (
                  <span className="text-destructive-text">
                    This browser can&apos;t generate a secure password. Type one in instead.
                  </span>
                )}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onCreate} loading={busy}>
              Create owner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={dialog?.kind === 'reset'} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'reset' && `${dialog.account.name} will be signed out everywhere.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">The owner must change it at their next sign-in.</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onReset} loading={busy}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate / deactivate */}
      <Dialog open={dialog?.kind === 'toggle'} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === 'toggle' && dialog.account.isActive
                ? 'Deactivate owner?'
                : 'Reactivate owner?'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'toggle' && dialog.account.isActive
                ? 'They will be signed out and unable to sign in. Products, stock and sales records are kept.'
                : 'They will be able to sign in again. Their store data is unchanged.'}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={dialog?.kind === 'toggle' && dialog.account.isActive ? 'destructive' : 'default'}
              onClick={onToggle}
              loading={busy}
            >
              {dialog?.kind === 'toggle' && dialog.account.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
