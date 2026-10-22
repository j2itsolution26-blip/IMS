'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck, ShieldX, UserPlus } from 'lucide-react';
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

  const close = () => {
    setDialog(null);
    setForm({ name: '', username: '', email: '', password: '', phone: '' });
    setPassword('');
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

      <div className="overflow-hidden rounded-xl border bg-card">
        {accounts.length === 0 ? (
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
              <Input
                id="owner-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters with upper and lower case, a number and a symbol. The owner can
                change it from Settings once signed in.
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
              autoFocus
            />
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
