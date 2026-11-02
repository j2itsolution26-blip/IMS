'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/form';
import { generatePassword } from '@/lib/password';
import { USERNAME_HINT, normalizeUsername } from '@/lib/username';
import { createStoreDemoAction } from '@/features/platform/subscription-actions';

/**
 * Creates a store's demonstration account: a separate demo store with its own
 * owner login and sample data. The administrator chooses the username and a
 * temporary password to hand over; it must be changed at first sign-in.
 */
export function DemoAccountButton({ storeId, storeName, suggestedUsername }: { storeId: string; storeName: string; suggestedUsername: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState(suggestedUsername);
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = () => {
    setUsername(suggestedUsername);
    setPassword(generatePassword());
    setError(null);
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createStoreDemoAction({ storeId, username: normalizeUsername(username), password });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.error : result.error);
      return;
    }
    toast.success(`Demo account created. Sign in as ${normalizeUsername(username)} with the password shown.`, { duration: 10000 });
    setOpen(false);
    router.push(`/system-admin/stores/${result.data.storeId}`);
  };

  return (
    <>
      <Button variant="outline" size="lg" className="h-11" onClick={start}>
        <FlaskConical /> Create demo account
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Demo account for {storeName}</DialogTitle>
            <DialogDescription>
              A separate demo store with sample products, for training and showing the system. Nothing done there touches {storeName}&apos;s
              real sales, stock, cash, staff or billing. It is never billed and can be reset.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={error} />
            <div className="space-y-1.5">
              <Label htmlFor="demo-username">Demo login username</Label>
              <Input id="demo-username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
              <p className="text-xs text-muted-foreground">{USERNAME_HINT}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-password">Temporary password</Label>
              <Input id="demo-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
              <p className="text-xs text-muted-foreground">Copy it now and give it to the owner. It must be changed at first sign-in.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Create demo account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
