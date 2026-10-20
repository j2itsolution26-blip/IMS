import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

/** Shown when a role may open the dashboard but holds nothing it could display. */
export function AccessDenied() {
  return (
    <EmptyState
      icon={Lock}
      title="Nothing to show yet"
      description="Your role can open the dashboard but has no store areas to report on. Ask the owner to grant inventory or POS access."
    />
  );
}
