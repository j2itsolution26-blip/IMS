import type { OutboxEntry } from '@/features/offline/local-db';
import type { SyncState } from '@/features/offline/sync-engine';

/**
 * What the till's sync indicator says. Pure, so the wording is tested.
 *
 * "Online" is never taken from the browser's flag alone: the browser only
 * knows a network is attached. The last request to the server decides
 * whether it is reachable.
 */

export type SyncTone = 'ok' | 'pending' | 'busy' | 'offline' | 'error';

export interface SyncStatusView {
  tone: SyncTone;
  label: string;
  detail: string;
}

export function describeSyncStatus(state: SyncState, browserOnline: boolean): SyncStatusView {
  const offline = !browserOnline || state.reachable === false;
  const pending = state.pending;
  const sales = (n: number) => `${n} sale${n === 1 ? '' : 's'}`;

  if (state.available === false) {
    return {
      tone: 'error',
      label: 'Not saving on device',
      detail: 'This browser will not let the till keep sales on the device (private window or blocked site data). Sales still go straight to the server.',
    };
  }
  // Not read yet: never claim "synced" before the device has been checked.
  if (state.available === null) return { tone: 'busy', label: 'Checking…', detail: 'Reading the sales saved on this device.' };
  if (state.syncing) return { tone: 'busy', label: 'Synchronizing', detail: `Sending ${sales(pending)} to the server.` };
  if (state.attention > 0) {
    return {
      tone: 'error',
      label: `Sync error · ${state.attention}`,
      detail: `${sales(state.attention)} need${state.attention === 1 ? 's' : ''} attention. They stay on this device until resolved.`,
    };
  }
  if (offline) {
    return {
      tone: 'offline',
      label: pending > 0 ? `Offline · ${pending} pending` : 'Offline',
      detail:
        pending > 0
          ? `${sales(pending)} saved on this device will be sent when the connection returns.`
          : 'The server cannot be reached.',
    };
  }
  if (pending > 0) return { tone: 'pending', label: `Online · ${pending} pending`, detail: `${sales(pending)} waiting to be sent.` };
  return { tone: 'ok', label: 'Online · Synced', detail: 'Every sale on this device has reached the server.' };
}

/** One line on what is happening with an unsent sale. */
export function describeEntry(entry: Pick<OutboxEntry, 'status' | 'lastError' | 'nextAttemptAt'>, now = Date.now()): string {
  const reason = entry.lastError?.message;
  switch (entry.status) {
    case 'pending':
      if (entry.nextAttemptAt && entry.nextAttemptAt > now) {
        const seconds = Math.ceil((entry.nextAttemptAt - now) / 1000);
        return `Waiting to send${reason ? ` (${reason})` : ''}. Next try in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`;
      }
      return 'Waiting to send.';
    case 'reauth':
      return 'Sign in again to send this sale.';
    case 'blocked':
      return reason ?? 'Cannot be sent yet.';
    case 'rejected':
      return `The server refused it: ${reason ?? 'no reason given'}. It stays here for the owner to review.`;
    case 'declined':
      return `Not completed at the counter: ${reason ?? 'refused'}. Nothing was charged.`;
    case 'synced':
      return 'Sent.';
  }
}
