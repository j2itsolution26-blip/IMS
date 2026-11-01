import Link from 'next/link';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface StaffAllowance {
  planName: string;
  /** Active staff accounts, owner excluded; limit null = unlimited. */
  total: { used: number; limit: number | null };
  /** One entry per role slot; empty on a plan without role slots. */
  roles: { slug: string; name: string; used: number; limit: number | null; holders: string[] }[];
  /** Whether to offer the upgrade link: the viewer manages billing and a higher plan exists. */
  canUpgrade: boolean;
}

const fraction = (used: number, limit: number | null) =>
  limit === null ? `${formatNumber(used, 0)} active` : `${formatNumber(used, 0)}/${formatNumber(limit, 0)}`;

/**
 * How many staff accounts the plan allows and how many are in use: "Cashier:
 * 1/1 · Inventory Staff: 0/1" on Basic, the total on the others. Display
 * only; the server actions and the database trigger enforce the numbers.
 */
export function StaffAllowanceCard({ allowance, className }: { allowance: StaffAllowance; className?: string }) {
  const { total, roles } = allowance;
  const totalFull = total.limit !== null && total.used >= total.limit;
  const fullRoles = roles.filter((role) => role.limit !== null && role.used >= role.limit);
  const anyFull = totalFull || fullRoles.length > 0;

  return (
    <section
      aria-labelledby="staff-allowance-title"
      className={cn('mb-4 flex flex-wrap items-start gap-x-4 gap-y-2 rounded-card border bg-card p-3 text-sm', className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 id="staff-allowance-title" className="font-medium">
          Staff allowance
        </h2>
        <span className="text-xs text-muted-foreground">{allowance.planName} plan · owner not counted</span>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Staff accounts in use">
        {roles.map((role) => (
          <li key={role.slug}>
            <Badge variant={role.limit !== null && role.used >= role.limit ? 'warning' : 'secondary'}>
              {role.name}: {fraction(role.used, role.limit)}
            </Badge>
          </li>
        ))}
        <li>
          <Badge variant={totalFull ? 'warning' : 'secondary'}>
            {roles.length > 0 ? 'Total' : 'Staff'}: {fraction(total.used, total.limit)}
          </Badge>
        </li>
      </ul>

      {anyFull && (
        <p className="basis-full text-xs text-muted-foreground">
          {fullRoles.map((role) => (
            <span key={role.slug} className="mr-1">
              The {role.name} slot is filled{role.holders.length > 0 ? ` by ${role.holders.join(', ')}` : ''}.
            </span>
          ))}
          {totalFull && fullRoles.length === 0 && <span className="mr-1">Every staff place on your plan is in use.</span>}
          Deactivate an account to free its place
          {allowance.canUpgrade ? (
            <>
              , or{' '}
              <Link href="/settings/subscription" className="font-medium text-primary underline-offset-2 hover:underline">
                upgrade your plan
              </Link>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      )}
    </section>
  );
}
