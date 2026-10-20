'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlayCircle, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OpenShiftDialog } from '@/features/pos/open-shift-dialog';

/**
 * The way into the till. With a shift open it resumes it; without one it asks
 * for the starting cash first, then goes to the POS. The shift state comes
 * from the server, and opening is idempotent there, so a stale page can never
 * create a second shift.
 */
export function PosEntryButton({
  hasOpenShift,
  suggestedAmount,
  currency,
  className,
}: {
  hasOpenShift: boolean;
  suggestedAmount: number;
  currency: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  if (hasOpenShift) {
    return (
      <Button asChild size="lg" className={cn('h-12 rounded-xl px-6 text-base', className)}>
        <Link href="/pos">
          <PlayCircle /> Resume shift
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button size="lg" className={cn('h-12 rounded-xl px-6 text-base', className)} onClick={() => setOpen(true)}>
        <ShoppingCart /> Open Point of Sale
      </Button>
      <OpenShiftDialog
        open={open}
        onOpenChange={setOpen}
        suggestedAmount={suggestedAmount}
        currency={currency}
        onOpened={() => {
          setOpen(false);
          router.push('/pos');
        }}
      />
    </>
  );
}
