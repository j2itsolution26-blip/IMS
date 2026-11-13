'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, ShieldOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { resolveSyncIssueAction, setDeviceRevokedAction } from '@/features/offline/review-actions';

const NETWORK_ERROR = 'Could not reach the server. Refresh to see whether it went through before trying again.';

/** The owner records what was checked or done, which closes the issue. */
export function ResolveIssueButton({ issueId, title, guidance }: { issueId: string; title: string; guidance: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || note.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resolveSyncIssueAction({ issueId, note: note.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Marked as resolved');
      setOpen(false);
      setNote('');
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen(true)}>
        <CheckCircle2 /> Resolve
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Resolve: {title}</DialogTitle>
              <DialogDescription>{guidance} The sale itself is not changed.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Label htmlFor={`note-${issueId}`}>What was checked or done</Label>
              <Textarea
                id={`note-${issueId}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
                autoFocus
                placeholder="e.g. Counted 4 on the shelf, adjusted stock."
              />
              {error && (
                <p role="alert" className="text-sm text-destructive-text">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-5 gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" className="h-11" loading={busy} disabled={note.trim().length < 3}>
                Mark resolved
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Removes a device from offline selling, or allows it again. */
export function DeviceAccessButton({ deviceId, label, revoked }: { deviceId: string; label: string; revoked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await setDeviceRevokedAction({ deviceId, revoked: !revoked });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(revoked ? `${label} can sell offline again` : `${label} was removed from offline sales`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant={revoked ? 'outline' : 'ghost'} className="h-9" onClick={() => setOpen(true)}>
        {revoked ? <ShieldCheck /> : <ShieldOff />} {revoked ? 'Allow' : 'Remove'}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !busy && setOpen(next)}
        title={revoked ? `Allow ${label} again?` : `Remove ${label} from offline sales?`}
        description={
          revoked
            ? 'The device can download the product list and sell offline again once a signed-in cashier opens the till on it.'
            : 'It stops receiving the product list, so it can no longer sell offline once it next connects (and at the latest when its offline access period ends). Sales it already took still upload and are flagged for you, so no money is lost.'
        }
        confirmLabel={revoked ? 'Allow device' : 'Remove device'}
        loadingLabel={revoked ? 'Allowing…' : 'Removing…'}
        destructive={!revoked}
        icon={revoked ? ShieldCheck : ShieldOff}
        loading={busy}
        onConfirm={confirm}
      />
    </>
  );
}
