'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Error boundary for authenticated pages.
 *
 * Next.js replaces thrown messages with an opaque digest in production, so the
 * copy here explains what the user can do rather than pretending to describe
 * the fault. Permission failures are the common case and get a clearer message.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[app] page error', error);
  }, [error]);

  const isPermission = /permission|forbidden/i.test(error.message);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <CardTitle>{isPermission ? 'You do not have access' : 'Something went wrong'}</CardTitle>
          <CardDescription>
            {isPermission
              ? 'Your role does not include permission for this page. Ask an administrator if you need it.'
              : 'The page could not be loaded. This has been logged on the server.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error.digest && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!isPermission && (
              <Button onClick={reset} variant="outline">
                <RefreshCw /> Try again
              </Button>
            )}
            <Button asChild>
              <Link href="/dashboard">
                <Home /> Back to dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
