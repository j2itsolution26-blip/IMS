'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject, optionalText, text } from '@/lib/form';
import { nextNumber } from '@/lib/counters';
import { formatSequence } from '@/lib/codes';
import { manilaParts, parseManilaDateTime } from '@/lib/dates';
import { CASE_STATUS_LABELS } from '@/lib/format';
import { runAction, type ActionResult } from '@/lib/action';

const dateTime = (label: string) =>
  z.string().transform((v, ctx) => {
    const d = parseManilaDateTime(v);
    if (!d) {
      ctx.addIssue({ code: 'custom', message: `Enter the ${label}.` });
      return z.NEVER;
    }
    return d;
  });

const STATUSES = ['RECORDED', 'MEDIATION', 'CONCILIATION', 'ARBITRATION', 'SETTLED', 'CFA_ISSUED', 'DISMISSED', 'WITHDRAWN'] as const;
const CLOSED = new Set(['SETTLED', 'CFA_ISSUED', 'DISMISSED', 'WITHDRAWN']);

const caseSchema = z.object({
  kind: z.enum(['BLOTTER', 'KP']),
  complainant: text('Complainant', 200),
  respondent: text('Respondent', 200),
  natureOfCase: text('Nature of the case', 150),
  incidentAt: dateTime('date and time of the incident'),
  incidentPlace: text('Place of the incident', 200),
  narrative: text('Narrative', 5000),
});

export async function createCase(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('blotter.edit');
    const input = caseSchema.parse(formObject(fd));
    if (input.incidentAt > new Date(Date.now() + 5 * 60_000)) return { error: 'The incident date cannot be in the future.' };
    const { y } = manilaParts(new Date());
    const created = await prisma.$transaction(async (tx) => {
      const n = await nextNumber(tx, `case-${y}`);
      const c = await tx.blotterCase.create({
        data: {
          ...input,
          caseNo: formatSequence(input.kind === 'KP' ? 'KP' : 'BL', y, n, 4),
          status: input.kind === 'KP' ? 'MEDIATION' : 'RECORDED',
          recordedById: user.id,
        },
      });
      await audit({ userId: user.id, action: 'case.create', entity: 'BlotterCase', entityId: c.id, summary: `Recorded ${c.caseNo}: ${c.natureOfCase}` }, tx);
      return c;
    });
    revalidatePath('/blotter');
    redirect(`/blotter/${created.id}`);
  });
}

const statusSchema = z.object({
  id: text('Case', 40),
  status: z.enum(STATUSES),
  resolution: optionalText(3000),
});

export async function updateCaseStatus(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('blotter.edit');
    const { id, status, resolution } = statusSchema.parse(formObject(fd));
    if (CLOSED.has(status) && !resolution) return { error: 'Describe the settlement or outcome before closing the case.' };
    const c = await prisma.blotterCase.update({
      where: { id },
      data: { status, resolution, closedAt: CLOSED.has(status) ? new Date() : null },
    });
    await audit({ userId: user.id, action: 'case.status', entity: 'BlotterCase', entityId: id, summary: `${c.caseNo} → ${CASE_STATUS_LABELS[status]}` });
    revalidatePath(`/blotter/${id}`);
    return { ok: `Status set to ${CASE_STATUS_LABELS[status]}.` };
  });
}

const hearingSchema = z.object({
  caseId: text('Case', 40),
  scheduledAt: dateTime('hearing date and time'),
  stage: z.enum(['MEDIATION', 'CONCILIATION', 'ARBITRATION']),
  notes: optionalText(2000),
});

export async function addHearing(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('blotter.edit');
    const input = hearingSchema.parse(formObject(fd));
    const c = await prisma.blotterCase.findUnique({ where: { id: input.caseId } });
    if (!c) return { error: 'Case not found.' };
    if (CLOSED.has(c.status)) return { error: 'This case is closed.' };
    await prisma.hearing.create({ data: input });
    await audit({ userId: user.id, action: 'case.hearing', entity: 'BlotterCase', entityId: c.id, summary: `Hearing scheduled for ${c.caseNo}` });
    revalidatePath(`/blotter/${c.id}`);
    return { ok: 'Hearing added.' };
  });
}
