import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileBarChart } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { REPORTS } from '@/server/reports/registry';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const user = await requirePermission('reports.view');

  // Only list reports the signed-in role can actually open.
  const available = REPORTS.filter((report) => userCan(user, report.permission));

  const groups = available.reduce((map, report) => {
    const list = map.get(report.group) ?? [];
    list.push(report);
    map.set(report.group, list);
    return map;
  }, new Map<string, typeof REPORTS>());

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report queries the database live. Export any of them to CSV, Excel, or PDF."
      />

      <div className="space-y-6">
        {[...groups.entries()].map(([group, reports]) => (
          <section key={group} aria-labelledby={`group-${group}`}>
            <h2 id={`group-${group}`} className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {reports.map((report) => (
                <Link key={report.id} href={`/reports/${report.id}`} className="group">
                  <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-start justify-between gap-2 text-base">
                        <span className="flex items-center gap-2">
                          <FileBarChart className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          {report.name}
                        </span>
                        <ArrowRight
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{report.description}</CardDescription>
                      {!report.usesDateRange && (
                        <Badge variant="secondary" className="mt-2">
                          Current position
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
