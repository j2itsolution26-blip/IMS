import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A titled card on an analytics screen.
 *
 * Shared by the dashboard and the sales screen so both read as one system
 * rather than two takes on the same idea.
 */
export function Panel({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  /** For in-page links to the panel. */
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // min-w-0 matters: a grid and flex child defaults to min-width:auto, so
    // without it a wide table or chart pushes the whole page sideways on a
    // phone instead of scrolling inside its own panel.
    <Card id={id} className={cn('flex min-w-0 flex-col overflow-hidden rounded-card', className)}>
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </Card>
  );
}

/** A panel with nothing in it still has to say something useful. */
export function PanelEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <Icon className="mb-1 h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** The "View all →" affordance in a panel header. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
    >
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}
