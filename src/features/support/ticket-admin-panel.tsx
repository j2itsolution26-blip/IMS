'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Lock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  PRIORITY_INFO,
  STATUS_INFO,
  SUPPORT_PRIORITIES,
  adminTargets,
  isConsequentialTransition,
  type SupportPriority,
  type SupportStatus,
} from '@/lib/support';
import { assignTicketAction, changeTicketStatusAction, setTicketPriorityAction } from '@/features/support/admin-actions';

const SELECT =
  'h-9 w-full rounded-full border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50';

const CONFIRM: Partial<Record<SupportStatus, { title: string; description: string; label: string }>> = {
  RESOLVED: {
    title: 'Mark this ticket resolved?',
    description: 'The requester sees it as solved. If they reply, it reopens automatically.',
    label: 'Mark resolved',
  },
  CLOSED: {
    title: 'Close this ticket?',
    description: 'The requester can no longer reply to it. Only an administrator can reopen it.',
    label: 'Close ticket',
  },
  OPEN: {
    title: 'Reopen this closed ticket?',
    description: 'The requester can reply again, and the reopening is recorded in the audit log.',
    label: 'Reopen',
  },
};

/**
 * Status, priority and assignment for one ticket. Only offers the moves the
 * workflow allows from the current status; the server checks them again
 * against the stored status, so a stale page cannot skip a step.
 */
export function TicketAdminPanel({
  number,
  status,
  priority,
  assigneeId,
  admins,
  canManage,
}: {
  number: string;
  status: SupportStatus;
  priority: SupportPriority;
  assigneeId: string | null;
  admins: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<SupportStatus | null>(null);
  const targets = adminTargets(status);

  const run = async (key: string, call: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setPending(key);
    try {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Could not save the change.');
        router.refresh();
      }
    } catch {
      toast.error('Could not save the change. Check your connection.');
    } finally {
      setPending(null);
      setConfirm(null);
    }
  };

  const moveTo = (to: SupportStatus) => {
    if (isConsequentialTransition(status, to)) setConfirm(to);
    else void run('status', () => changeTicketStatusAction({ number, to, from: status }), `Status changed to ${STATUS_INFO[to].label}.`);
  };

  const quick = status === 'CLOSED' ? 'OPEN' : targets.includes('RESOLVED') ? 'RESOLVED' : targets.includes('CLOSED') ? 'CLOSED' : null;
  const dialog = confirm ? CONFIRM[confirm] : null;

  return (
    <div className="space-y-4">
      {canManage && quick && (
        <Button
          className="w-full"
          variant={quick === 'RESOLVED' ? 'success' : quick === 'CLOSED' ? 'outline' : 'default'}
          onClick={() => moveTo(quick)}
          disabled={pending !== null}
        >
          {quick === 'RESOLVED' ? <CheckCircle2 aria-hidden="true" /> : quick === 'CLOSED' ? <Lock aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          {quick === 'RESOLVED' ? 'Mark resolved' : quick === 'CLOSED' ? 'Close ticket' : 'Reopen ticket'}
        </Button>
      )}

      <div className="space-y-1.5">
        <label htmlFor="ticket-status" className="text-xs font-medium text-muted-foreground">Status</label>
        <select
          id="ticket-status"
          className={SELECT}
          value={status}
          disabled={!canManage || pending !== null}
          onChange={(event) => moveTo(event.target.value as SupportStatus)}
        >
          <option value={status}>{status === 'WAITING_FOR_USER' ? 'Waiting for user' : STATUS_INFO[status].label} (current)</option>
          {targets.map((target) => (
            <option key={target} value={target}>
              {target === 'WAITING_FOR_USER' ? 'Waiting for user' : STATUS_INFO[target].label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ticket-priority" className="text-xs font-medium text-muted-foreground">Priority</label>
        <select
          id="ticket-priority"
          className={SELECT}
          value={priority}
          disabled={!canManage || pending !== null}
          onChange={(event) => {
            const next = event.target.value as SupportPriority;
            void run('priority', () => setTicketPriorityAction({ number, priority: next }), `Priority set to ${PRIORITY_INFO[next].label}.`);
          }}
        >
          {SUPPORT_PRIORITIES.map((value) => (
            <option key={value} value={value}>{PRIORITY_INFO[value].label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ticket-assignee" className="text-xs font-medium text-muted-foreground">Assigned to</label>
        <select
          id="ticket-assignee"
          className={SELECT}
          value={assigneeId ?? ''}
          disabled={!canManage || pending !== null}
          onChange={(event) => {
            const next = event.target.value || null;
            void run('assign', () => assignTicketAction({ number, assigneeId: next }), next ? 'Ticket assigned.' : 'Ticket unassigned.');
          }}
        >
          <option value="">Nobody</option>
          {admins.map((admin) => (
            <option key={admin.id} value={admin.id}>{admin.name}</option>
          ))}
        </select>
      </div>

      {!canManage && <p className="text-xs text-muted-foreground">You can read this ticket but not change it.</p>}

      {dialog && confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.label}
          destructive={confirm === 'CLOSED'}
          loading={pending === 'status'}
          loadingLabel="Saving…"
          onConfirm={() =>
            run('status', () => changeTicketStatusAction({ number, to: confirm, from: status }), `Status changed to ${STATUS_INFO[confirm].label}.`)
          }
        />
      )}
    </div>
  );
}
