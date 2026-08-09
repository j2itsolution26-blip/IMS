import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProfileForm } from '@/features/admin/profile-form';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requireUser();

  const [record, recentActivity] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true, phone: true, lastLoginAt: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, summary: true, createdAt: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Your profile" description="Your account details and what your role allows." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details</CardTitle>
            <CardDescription>
              Your email and role are managed by an administrator. Contact them if either needs to change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              email={record?.email ?? user.email}
              roleName={user.role.name}
              defaultValues={{ name: record?.name ?? user.name, phone: record?.phone ?? '' }}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="default">{user.role.name}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Permissions</span>
                <span className="font-medium">{user.permissions.size}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last signed in</span>
                <span className="font-medium">
                  {record?.lastLoginAt ? formatDateTime(record.lastLoginAt) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Member since</span>
                <span className="font-medium">
                  {record?.createdAt ? formatDateTime(record.createdAt) : '—'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your recent activity</CardTitle>
              <CardDescription>Taken from the audit trail.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentActivity.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p className="line-clamp-2">{entry.summary}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
