import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { CASE_STATUS_LABELS, fmtDateTime, OPEN_CASE_STATUSES } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Empty, Field, PageHeader } from '@/components/ui';
import { audit } from '@/lib/audit';
import { addHearing, updateCaseStatus } from '../actions';

export const metadata = { title: 'Case' };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('blotter.view');
  const { id } = await params;
  const c = await prisma.blotterCase.findUnique({
    where: { id },
    include: { hearings: { orderBy: { scheduledAt: 'asc' } }, recordedBy: { select: { fullName: true } } },
  });
  if (!c) notFound();
  // Case files are confidential: record every view.
  await audit({ userId: user.id, action: 'case.view', entity: 'BlotterCase', entityId: c.id, summary: `Viewed ${c.caseNo}` });
  const open = (OPEN_CASE_STATUSES as readonly string[]).includes(c.status);
  const edit = can(user.role, 'blotter.edit');

  return (
    <>
      <PageHeader title={c.caseNo} description={`${c.kind === 'KP' ? 'Katarungang Pambarangay' : 'Blotter'} · ${c.natureOfCase}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-4">
              <Badge tone={open ? 'amber' : c.status === 'SETTLED' ? 'green' : 'gray'}>{CASE_STATUS_LABELS[c.status]}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Complainant</dt>
                <dd>{c.complainant}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Respondent</dt>
                <dd>{c.respondent}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Incident</dt>
                <dd>
                  {fmtDateTime(c.incidentAt)} · {c.incidentPlace}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Recorded</dt>
                <dd>
                  {fmtDateTime(c.filedAt)} by {c.recordedBy.fullName}
                </dd>
              </div>
            </dl>
            <h3 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Narrative</h3>
            <p className="whitespace-pre-wrap text-sm">{c.narrative}</p>
            {c.resolution && (
              <>
                <h3 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Outcome</h3>
                <p className="whitespace-pre-wrap text-sm">{c.resolution}</p>
              </>
            )}
          </Card>
          <Card title="Hearings">
            {c.hearings.length === 0 ? (
              <Empty>No hearings yet.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {c.hearings.map((h) => (
                  <li key={h.id} className="py-2">
                    <div className="font-medium">
                      {fmtDateTime(h.scheduledAt)} · {CASE_STATUS_LABELS[h.stage]}
                    </div>
                    {h.notes && <p className="whitespace-pre-wrap text-slate-600">{h.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {edit && (
          <div className="space-y-6">
            {open && (
              <Card title="Schedule a hearing">
                <ActionForm action={addHearing} submitLabel="Add hearing" resetOnSuccess>
                  <input type="hidden" name="caseId" value={c.id} />
                  <Field label="Date and time">
                    <input name="scheduledAt" type="datetime-local" className="input" required />
                  </Field>
                  <Field label="Stage">
                    <select name="stage" className="input" defaultValue="MEDIATION">
                      <option value="MEDIATION">Mediation (Punong Barangay)</option>
                      <option value="CONCILIATION">Conciliation (Pangkat)</option>
                      <option value="ARBITRATION">Arbitration</option>
                    </select>
                  </Field>
                  <Field label="Notes">
                    <textarea name="notes" rows={3} className="input" />
                  </Field>
                </ActionForm>
              </Card>
            )}
            <Card title="Update status">
              <ActionForm action={updateCaseStatus} submitLabel="Update status">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Status">
                  <select name="status" className="input" defaultValue={c.status}>
                    {Object.entries(CASE_STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Settlement / outcome" hint="Required when closing a case.">
                  <textarea name="resolution" rows={4} className="input" defaultValue={c.resolution} />
                </Field>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
