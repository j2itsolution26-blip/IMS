import { Skeleton } from '@/components/ui/misc';

/** The billing page's shape while it loads: summary and usage, plans, history. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading subscription and billing">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-card lg:col-span-2" />
        <Skeleton className="h-64 rounded-card" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-80 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}
