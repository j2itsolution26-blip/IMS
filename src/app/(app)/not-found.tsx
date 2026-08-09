import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </span>
          <CardTitle>Not found</CardTitle>
          <CardDescription>
            That record does not exist, or it has been deleted since the link was created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">
              <Home /> Back to dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
