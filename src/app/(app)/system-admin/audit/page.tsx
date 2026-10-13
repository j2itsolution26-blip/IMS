import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { listAccountAudit } from '@/features/platform/queries';
import { formatDateTime } from '@/lib/format';
import { Panel, PanelEmpty } from '@/components/panel';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requirePermission('platform.view');
  const entries = await listAccountAudit(100);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Administrative actions on accounts. Passwords and tokens are never recorded.
        </p>
      </div>

      <Panel title="Account activity" description={`${entries.length} most recent entries.`}>
        {entries.length === 0 ? (
          <PanelEmpty
            icon={Activity}
            title="Nothing recorded yet"
            description="Account creation, password resets and deactivations appear here."
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[640px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Summary</TableHead>
                  <TableHead scope="col">Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{entry.summary}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.actorName ?? 'System'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
