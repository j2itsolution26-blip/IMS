import Link from 'next/link';
import { BrandLogo } from '@/components/brand';
import { Button } from '@/components/ui/button';

/**
 * Root not-found, used for URLs outside the authenticated shell.
 * Sends the visitor to the dashboard, which will redirect to sign-in if needed.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-muted/30 px-4 text-center">
      <BrandLogo sizes="160px" className="w-[160px]" />

      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          That address doesn&apos;t match anything in this system.
        </p>
      </div>

      <Button asChild>
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
