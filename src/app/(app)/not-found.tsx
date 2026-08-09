import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Not-found page for authenticated routes.
 *
 * Renders inside the app shell so the sidebar stays available — a dead end with
 * no navigation is the worst possible response to a stale link.
 */
export default function AppNotFound() {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </span>

      <h1 className="text-lg font-semibold">We couldn&apos;t find that</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The record may have been deleted, or the link may be out of date. Everything else is still
        available from the sidebar.
      </p>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/products">Browse products</Link>
        </Button>
      </div>
    </Card>
  );
}
