'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Store } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { selectBranchAction } from '@/features/branches/actions';

export interface BranchBarProps {
  branches: { id: string; name: string; restricted: boolean }[];
  selected: string;
  canSwitch: boolean;
  /** Shown to the owner when branches are over the plan's limit. */
  overLimit: { active: number; limit: number } | null;
}

const ALL = 'all';

/**
 * The branch the screens below are showing. The owner of a store with more
 * than one branch picks one, or all of them; everyone else sees the branch
 * they work at. The choice is checked on the server for every request.
 */
export function BranchBar({ branches, selected, canSwitch, overLimit }: BranchBarProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const current = branches.find((branch) => branch.id === selected);

  const choose = (value: string) => {
    startTransition(async () => {
      const result = await selectBranchAction({ branch: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Store className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground" id="branch-bar-label">
          Branch
        </span>
        {canSwitch ? (
          <Select value={selected} onValueChange={choose} disabled={pending}>
            <SelectTrigger className="h-9 w-auto min-w-[12rem]" aria-labelledby="branch-bar-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All branches</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                  {branch.restricted ? ' (over plan limit)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-medium">{current?.name ?? 'Main branch'}</span>
        )}
        {selected === ALL && <span className="text-xs text-muted-foreground">Figures add up every branch. New sales and stock go to the main branch.</span>}
      </div>
      {overLimit && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your plan allows {overLimit.limit} {overLimit.limit === 1 ? 'location' : 'locations'} and {overLimit.active} are active. Branches over the limit can be viewed but take no
            new sales, shifts or stock. Nothing has been deleted.{' '}
            <Link href="/settings/branches" className="font-medium underline">
              Choose which branches to keep
            </Link>{' '}
            or{' '}
            <Link href="/settings/subscription#plans" className="font-medium underline">
              upgrade
            </Link>
            .
          </span>
        </p>
      )}
    </div>
  );
}
