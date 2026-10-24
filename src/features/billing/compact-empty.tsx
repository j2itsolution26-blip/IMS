import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Small building blocks for the billing page, safe to use from server and client components. */

/** A small empty state: one line of what is missing and what to do. */
export function CompactEmpty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </>
  );
}
