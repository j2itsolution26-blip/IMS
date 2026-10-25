import { Skeleton } from '@/components/ui/misc';

/** The billing page's shape while it loads: plans, subscription summary, details. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading subscription and billing">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-36 rounded-card" />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[30rem] rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-card" />
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}
