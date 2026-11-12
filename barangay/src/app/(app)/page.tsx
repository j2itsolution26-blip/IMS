import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/session';
import { can } from '@/lib/permissions';
import { bornOnOrBefore, manilaMonthRange, manilaTodayRange } from '@/lib/dates';
import { CASE_STATUS_LABELS, fmtDateTime, OPEN_CASE_STATUSES, peso } from '@/lib/format';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const user = await requireUser();
  const today = manilaTodayRange();
  const month = manilaMonthRange();
  const active = { status: 'ACTIVE' as const };
  const seeMoney = can(user.role, 'receipts.view');
  const seeCases = can(user.role, 'blotter.view');

  const [
    population,
    households,
    seniors,
    pwd,
    fourPs,
    soloParents,
    voters,
    certsToday,
    certsMonth,
    collectedToday,
    collectedMonth,
    openCases,
    upcoming,
    byPurok,
    puroks,
  ] = await Promise.all([
    prisma.resident.count({ where: active }),
    prisma.household.count(),
    prisma.resident.count({ where: { ...active, birthDate: { lte: bornOnOrBefore(60) } } }),
    prisma.resident.count({ where: { ...active, isPwd: true } }),
    prisma.resident.count({ where: { ...active, is4Ps: true } }),
    prisma.resident.count({ where: { ...active, isSoloParent: true } }),
    prisma.resident.count({ where: { ...active, isVoter: true } }),
    prisma.certificate.count({ where: { issuedAt: { gte: today.start, lt: today.end } } }),
    prisma.certificate.count({ where: { issuedAt: { gte: month.start, lt: month.end } } }),
    prisma.receipt.aggregate({ _sum: { amount: true }, where: { status: 'PAID', paidAt: { gte: today.start, lt: today.end } } }),
    prisma.receipt.aggregate({ _sum: { amount: true }, where: { status: 'PAID', paidAt: { gte: month.start, lt: month.end } } }),
    prisma.blotterCase.count({ where: { status: { in: [...OPEN_CASE_STATUSES] } } }),
    seeCases
      ? prisma.hearing.findMany({
          where: { scheduledAt: { gte: today.start } },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
          include: { case: { select: { id: true, caseNo: true, complainant: true, respondent: true } } },
        })
      : Promise.resolve([]),
    prisma.resident.groupBy({ by: ['purokId'], where: active, _count: { _all: true } }),
    prisma.purok.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const purokCounts = puroks.map((p) => ({
    name: p.name,
    count: byPurok.find((b) => b.purokId === p.id)?._count._all ?? 0,
  }));
  const maxPurok = Math.max(1, ...purokCounts.map((p) => p.count));

  return (
    <>
      <PageHeader
        title={`Good day, ${user.fullName.split(' ')[0]}`}
        description="Today at the barangay hall, and the barangay at a glance."
        actions={
          can(user.role, 'certificates.issue') ? (
            <Link href="/certificates/new" className="btn-primary">
              Issue a certificate
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Certificates today" value={certsToday} note={`${certsMonth} this month`} href="/certificates" />
        {seeMoney && <Stat label="Collected today" value={peso(collectedToday._sum.amount ?? 0)} href="/receipts" />}
        {seeMoney && <Stat label="Collected this month" value={peso(collectedMonth._sum.amount ?? 0)} href="/reports" />}
        {seeCases && <Stat label="Open cases" value={openCases} href="/blotter?status=open" />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Population" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Residents" value={population} href="/residents" />
            <Stat label="Households" value={households} href="/households" />
            <Stat label="Registered voters" value={voters} href="/residents?sector=voter" />
            <Stat label="Senior citizens" value={seniors} href="/residents?sector=senior" />
            <Stat label="PWD" value={pwd} href="/residents?sector=pwd" />
            <Stat label="4Ps members" value={fourPs} href="/residents?sector=4ps" />
            <Stat label="Solo parents" value={soloParents} href="/residents?sector=solo" />
          </div>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">Residents by purok</h3>
          {purokCounts.length === 0 ? (
            <Empty>No puroks yet. Add them in Settings.</Empty>
          ) : (
            <ul className="space-y-2">
              {purokCounts.map((p) => (
                <li key={p.name} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="truncate">{p.name}</span>
                  <span className="h-3 rounded bg-slate-100">
                    <span className="block h-3 rounded bg-brand-600" style={{ width: `${(p.count / maxPurok) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {seeCases && (
          <Card title="Upcoming hearings">
            {upcoming.length === 0 ? (
              <Empty>No hearings scheduled.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((h) => (
                  <li key={h.id} className="py-2 text-sm">
                    <Link href={`/blotter/${h.case.id}`} className="font-medium text-brand-700 hover:underline">
                      {h.case.caseNo}
                    </Link>
                    <div className="text-slate-600">
                      {h.case.complainant} vs. {h.case.respondent}
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(h.scheduledAt)} · {CASE_STATUS_LABELS[h.stage]}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
