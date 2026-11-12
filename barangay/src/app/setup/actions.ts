'use server';

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { hashPassword, passwordProblem } from '@/lib/password';
import { createSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject, text } from '@/lib/form';
import { runAction, type ActionResult } from '@/lib/action';
import { DEFAULT_DOCUMENT_TYPES } from '@/lib/defaults';

const schema = z.object({
  token: z.string(),
  barangayName: text('Barangay name', 100),
  city: text('City or municipality', 100),
  province: text('Province', 100),
  captainName: text("Punong Barangay's full name", 120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, 'Username: 3–32 letters, numbers, dots, dashes or underscores.'),
  password: z.string(),
  puroks: z.string().optional().default(''),
});

function tokenMatches(given: string): boolean {
  const expected = process.env.SETUP_TOKEN ?? '';
  if (expected.length < 12) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function completeSetup(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = schema.parse(formObject(fd));
    if (!tokenMatches(input.token)) return { error: 'The setup token is wrong, or SETUP_TOKEN is not set on the server (12+ characters).' };
    const problem = passwordProblem(input.password);
    if (problem) return { error: problem };

    const passwordHash = await hashPassword(input.password);
    const puroks = [...new Set(input.puroks.split(/[\n,]/).map((p) => p.trim()).filter(Boolean))].slice(0, 50);

    const user = await prisma.$transaction(async (tx) => {
      // Serialise concurrent setups: only the first one may create the captain.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
      if ((await tx.user.count()) > 0) return null;
      await tx.barangaySettings.create({
        data: {
          barangayName: input.barangayName,
          city: input.city,
          province: input.province,
          captainName: input.captainName,
        },
      });
      for (const name of puroks) await tx.purok.create({ data: { name } });
      for (const t of DEFAULT_DOCUMENT_TYPES) await tx.documentType.create({ data: t });
      const created = await tx.user.create({
        data: { username: input.username, fullName: input.captainName, role: 'CAPTAIN', passwordHash },
      });
      await audit({ userId: created.id, action: 'setup', entity: 'BarangaySettings', summary: `Barangay ${input.barangayName} set up` }, tx);
      return created;
    });

    if (!user) return { error: 'Setup has already been completed. Sign in instead.' };
    await createSession(user.id);
    redirect('/');
  });
}
