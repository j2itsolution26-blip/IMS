import 'server-only';

import { randomBytes } from 'node:crypto';
import { APIError } from 'better-auth/api';
import { Prisma, type StorePlan, type SubscriptionPaymentMethod } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { runAsProvisioning } from '@/lib/provisioning-context';
import { getRequestContext } from '@/lib/session';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { OWNER_ROLE_SLUG } from '@/lib/permissions';
import { LIMIT_LABEL, PLANS, type LimitKey } from '@/lib/plans';
import { effectivePlanId, type StoreSubscription } from '@/lib/store-access';
import { MAX_TRIAL_EXTENSION_DAYS, PAYMENT_METHOD_LABEL, STATUS_LABEL, newTrial, normalizeReference, paymentPeriod } from '@/lib/subscription';
import { formatDate } from '@/lib/format';
import { slugify } from '@/lib/utils';
import { permissionIds, setUpStore, syncLimits } from '@/server/platform/store-setup';

/**
 * Subscription changes made by the platform administrator: creating a store
 * (with its trial), changing plan or status, extending a trial, and
 * confirming or voiding a manual payment.
 *
 * Callers check `platform.manage` first (src/features/platform/subscription-actions.ts).
 * Every change runs in one transaction that locks the store's row, re-copies
 * the plan's quotas onto it, and writes two audit entries: one in the store's
 * own trail (so the owner sees what changed) and one in the platform's, which
 * names the administrator. Nothing here trusts a store id, plan, price or
 * status from the browser beyond validating it.
 */

export interface Actor {
  id: string;
  name: string;
}

type Tx = Prisma.TransactionClient;
type LockedStore = StoreSubscription & { id: string; name: string };

const DAY = 86_400_000;
const TX = { timeout: 20_000, maxWait: 10_000 } as const;

async function lockStore(tx: Tx, storeId: string): Promise<LockedStore> {
  const [row] = await tx.$queryRaw<LockedStore[]>`
    SELECT id, name, plan::text AS plan, status::text AS status, "trialEndsAt", "currentPeriodEnd"
    FROM stores WHERE id = ${storeId} FOR UPDATE`;
  if (!row) throw new NotFoundError('Store');
  return row;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const snapshot = (store: StoreSubscription) => ({
  plan: store.plan,
  status: store.status,
  trialEndsAt: iso(store.trialEndsAt),
  currentPeriodEnd: iso(store.currentPeriodEnd),
});

async function audit(
  tx: Tx,
  actor: Actor,
  store: { id: string; name: string },
  entry: { action: 'SUBSCRIPTION' | 'PAYMENT' | 'CREATE'; entity: string; entityId: string; summary: string; changes: Record<string, unknown> },
) {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
  const base = { action: entry.action, entity: entry.entity, entityId: entry.entityId, ipAddress, userAgent };
  await tx.auditLog.createMany({
    data: [
      // The store's trail. Its actor is not one of the store's users, so it
      // is named in the entry rather than linked (the tenant guard allows a
      // store entry to link only that store's users).
      {
        ...base,
        storeId: store.id,
        userId: null,
        summary: `${entry.summary} (by the platform administrator)`,
        changes: { ...entry.changes, actor: { id: actor.id, name: actor.name } } as Prisma.InputJsonValue,
      },
      // The platform's trail, linked to the administrator.
      {
        ...base,
        storeId: null,
        userId: actor.id,
        summary: `${store.name}: ${entry.summary}`,
        changes: { ...entry.changes, storeId: store.id } as Prisma.InputJsonValue,
      },
    ],
  });
}

/** Which of the new plan's quotas the store is already over (nothing is deleted; it just cannot add more). */
async function overLimits(tx: Tx, storeId: string, subscription: Pick<StoreSubscription, 'plan' | 'status'>): Promise<string[]> {
  const limits = PLANS[effectivePlanId(subscription)].limits;
  const [counts] = await tx.$queryRaw<{ products: number; staff: number; branches: number }[]>`
    SELECT
      (SELECT count(*)::int FROM products WHERE "storeId" = s.id AND status <> 'ARCHIVED') AS products,
      (SELECT count(*)::int FROM users WHERE "storeId" = s.id AND "isActive" AND id IS DISTINCT FROM s."ownerId") AS staff,
      (SELECT count(*)::int FROM warehouses WHERE "storeId" = s.id) AS branches
    FROM stores s WHERE s.id = ${storeId}`;
  const over: string[] = [];
  for (const key of ['products', 'staff', 'branches'] as const satisfies readonly LimitKey[]) {
    const limit = limits[key];
    if (limit !== null && counts[key] > limit) over.push(`${counts[key]} ${LIMIT_LABEL[key]} (plan allows ${limit})`);
  }
  return over;
}

// --- Plan and status ----------------------------------------------------------

export async function changePlan(actor: Actor, input: { storeId: string; plan: StorePlan; reason: string }): Promise<{ overLimits: string[] }> {
  return platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, input.storeId);
    if (store.plan === input.plan) throw new ConflictError(`The store is already on the ${PLANS[input.plan].name} plan.`);
    await tx.store.update({ where: { id: store.id }, data: { plan: input.plan } });
    await syncLimits(tx, store.id);
    const after = { ...store, plan: input.plan };
    const over = await overLimits(tx, store.id, after);
    await audit(tx, actor, store, {
      action: 'SUBSCRIPTION',
      entity: 'Store',
      entityId: store.id,
      summary: `Plan changed from ${PLANS[store.plan].name} to ${PLANS[input.plan].name} — ${input.reason}`,
      changes: { before: snapshot(store), after: snapshot(after), reason: input.reason, overLimits: over },
    });
    return { overLimits: over };
  }, TX);
}

export type SettableStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';

export async function setStoreStatus(actor: Actor, input: { storeId: string; status: SettableStatus; reason: string }): Promise<void> {
  await platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, input.storeId);
    if (store.status === input.status) throw new ConflictError(`The store is already ${STATUS_LABEL[input.status].toLowerCase()}.`);
    // A trial has no paid period; activating it here would grant one for free.
    if (input.status === 'ACTIVE' && store.status === 'TRIAL') {
      throw new ConflictError('A trial store becomes active when a payment is recorded. Record the payment instead.');
    }
    await tx.store.update({ where: { id: store.id }, data: { status: input.status } });
    await syncLimits(tx, store.id);
    const after = { ...store, status: input.status };
    await audit(tx, actor, store, {
      action: 'SUBSCRIPTION',
      entity: 'Store',
      entityId: store.id,
      summary: `Status changed from ${STATUS_LABEL[store.status]} to ${STATUS_LABEL[input.status]} — ${input.reason}`,
      changes: { before: snapshot(store), after: snapshot(after), reason: input.reason },
    });
  }, TX);
}

export async function extendTrial(actor: Actor, input: { storeId: string; days: number; reason: string }, now = new Date()): Promise<{ trialEndsAt: Date }> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_TRIAL_EXTENSION_DAYS) {
    throw new ValidationError(`Extend by 1 to ${MAX_TRIAL_EXTENSION_DAYS} days.`, { days: [`Enter 1 to ${MAX_TRIAL_EXTENSION_DAYS} days.`] });
  }
  return platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, input.storeId);
    if (store.status !== 'TRIAL') throw new ConflictError('Only a store on trial can have its trial extended.');
    const from = store.trialEndsAt && store.trialEndsAt.getTime() > now.getTime() ? store.trialEndsAt : now;
    const trialEndsAt = new Date(from.getTime() + input.days * DAY);
    await tx.store.update({ where: { id: store.id }, data: { trialEndsAt } });
    const after = { ...store, trialEndsAt };
    await audit(tx, actor, store, {
      action: 'SUBSCRIPTION',
      entity: 'Store',
      entityId: store.id,
      summary: `Trial extended by ${input.days} day${input.days === 1 ? '' : 's'} to ${formatDate(trialEndsAt)} — ${input.reason}`,
      changes: { before: snapshot(store), after: snapshot(after), reason: input.reason, days: input.days },
    });
    return { trialEndsAt };
  }, TX);
}

// --- Manual payments ----------------------------------------------------------

export interface ManualPaymentInput {
  storeId: string;
  plan: StorePlan;
  amount: number;
  method: SubscriptionPaymentMethod;
  reference: string;
  paidAt: Date;
  months: number;
  notes?: string;
}

export async function recordManualPayment(actor: Actor, input: ManualPaymentInput, now = new Date()): Promise<{ id: string; periodEnd: Date }> {
  const reference = normalizeReference(input.reference);
  if (!reference) throw new ValidationError('Enter the payment reference.', { reference: ['Enter the reference number.'] });
  // A few minutes of clock difference is fine; a payment dated tomorrow is a typo.
  if (input.paidAt.getTime() > now.getTime() + 10 * 60_000) {
    throw new ValidationError('The payment date cannot be in the future.', { paidAt: ['Use the date the money arrived.'] });
  }

  try {
    return await platformPrisma.$transaction(async (tx) => {
      const store = await lockStore(tx, input.storeId);
      if (store.status === 'SUSPENDED') throw new ConflictError('This store is suspended. Reactivate it before recording a payment.');

      const existing = await tx.subscriptionPayment.findUnique({
        where: { method_reference: { method: input.method, reference } },
        select: { createdAt: true, store: { select: { name: true } } },
      });
      if (existing) throw duplicateReference(existing.store.name, existing.createdAt);

      const period = paymentPeriod(store, input.months, now);
      const payment = await tx.subscriptionPayment.create({
        data: {
          storeId: store.id,
          plan: input.plan,
          amount: new Prisma.Decimal(input.amount.toFixed(2)),
          currency: 'PHP',
          method: input.method,
          reference,
          paidAt: input.paidAt,
          months: input.months,
          periodStart: period.start,
          periodEnd: period.end,
          notes: input.notes?.trim() || null,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      await tx.store.update({ where: { id: store.id }, data: { plan: input.plan, status: 'ACTIVE', currentPeriodEnd: period.end } });
      await syncLimits(tx, store.id);

      const after = { ...store, plan: input.plan, status: 'ACTIVE' as const, currentPeriodEnd: period.end };
      await audit(tx, actor, store, {
        action: 'PAYMENT',
        entity: 'SubscriptionPayment',
        entityId: payment.id,
        summary:
          `Payment confirmed: ₱${input.amount.toFixed(2)} by ${PAYMENT_METHOD_LABEL[input.method]} (ref ${reference}) — ` +
          `${PLANS[input.plan].name}, ${input.months} month${input.months === 1 ? '' : 's'}, paid until ${formatDate(period.end)}`,
        changes: {
          before: snapshot(store),
          after: snapshot(after),
          payment: { amount: input.amount.toFixed(2), currency: 'PHP', method: input.method, reference, paidAt: iso(input.paidAt), months: input.months, periodStart: iso(period.start), periodEnd: iso(period.end) },
        },
      });
      return { id: payment.id, periodEnd: period.end };
    }, TX);
  } catch (error) {
    // Two administrators submitting the same transfer at once: the unique
    // index lets exactly one through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateReference(null, null);
    throw error;
  }
}

function duplicateReference(storeName: string | null, at: Date | null): ValidationError {
  const where = storeName && at ? ` for ${storeName} on ${formatDate(at)}` : '';
  return new ValidationError(`This reference was already recorded${where}. A payment can only be confirmed once.`, {
    reference: ['Already recorded.'],
  });
}

/**
 * Voids a payment recorded by mistake and takes back the time it bought.
 * Only the latest payment can be voided (later ones were stacked on top of
 * it); the record itself stays, marked void, with who, when and why.
 */
export async function voidPayment(actor: Actor, input: { paymentId: string; reason: string }, now = new Date()): Promise<void> {
  const payment = await platformPrisma.subscriptionPayment.findUnique({ where: { id: input.paymentId }, select: { storeId: true } });
  if (!payment) throw new NotFoundError('Payment');

  await platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, payment.storeId);
    const row = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: input.paymentId } });
    if (row.voidedAt) throw new ConflictError('This payment is already void.');
    if (!store.currentPeriodEnd || store.currentPeriodEnd.getTime() !== row.periodEnd.getTime()) {
      throw new ConflictError('Only the most recent payment can be voided. Void the later payments first.');
    }
    await tx.subscriptionPayment.update({
      where: { id: row.id },
      data: { voidedAt: now, voidedById: actor.id, voidReason: input.reason },
    });
    await tx.store.update({ where: { id: store.id }, data: { currentPeriodEnd: row.periodStart } });
    const after = { ...store, currentPeriodEnd: row.periodStart };
    await audit(tx, actor, store, {
      action: 'PAYMENT',
      entity: 'SubscriptionPayment',
      entityId: row.id,
      summary: `Payment voided: ₱${row.amount.toFixed(2)} (ref ${row.reference}); paid-until date back to ${formatDate(row.periodStart)} — ${input.reason}`,
      changes: { before: snapshot(store), after: snapshot(after), reason: input.reason },
    });
  }, TX);
}

// --- New stores ----------------------------------------------------------------

export interface NewStoreInput {
  storeName: string;
  owner: { name: string; username: string; email: string; password: string; phone?: string };
  /** The administrator saw the "similar store" warning and confirmed this is not a repeat trial. */
  allowSimilar: boolean;
}

/** Raised so the form can show the matches and ask the administrator to confirm. */
export class SimilarStoreError extends AppError {
  constructor(message: string) {
    super(message, 'SIMILAR_STORE', 409);
  }
}

/**
 * Creates a store with its own roles, warehouse and settings, its owner, and a
 * TRIAL_DAYS Business trial. If the owner cannot be created, the half-made
 * store is removed again, so a failed attempt leaves nothing behind.
 */
export async function createStore(actor: Actor, input: NewStoreInput, now = new Date()): Promise<{ storeId: string; ownerId: string }> {
  const name = input.storeName.trim();
  const email = input.owner.email.trim().toLowerCase();

  const [emailTaken, usernameTaken] = await Promise.all([
    platformPrisma.user.findUnique({ where: { email }, select: { id: true } }),
    platformPrisma.user.findUnique({ where: { username: input.owner.username }, select: { id: true } }),
  ]);
  if (emailTaken) throw new ValidationError('That email address already has an account.', { email: ['This email is already registered.'] });
  if (usernameTaken) throw new ValidationError('That username is already taken.', { username: ['This username is already in use.'] });

  // Trial abuse: the same shop signing up again under a new email.
  if (!input.allowSimilar) {
    const phone = input.owner.phone?.trim();
    const similar = await platformPrisma.store.findMany({
      where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, ...(phone ? [{ members: { some: { phone } } }] : [])] },
      select: { name: true, status: true, createdAt: true },
      take: 5,
    });
    if (similar.length > 0) {
      const list = similar.map((s) => `${s.name} (${STATUS_LABEL[s.status].toLowerCase()}, created ${formatDate(s.createdAt)})`).join('; ');
      throw new SimilarStoreError(`A store with the same name or owner phone already exists: ${list}. Confirm this is a different business before creating another trial.`);
    }
  }

  const slug = `${slugify(name) || 'store'}-${randomBytes(3).toString('hex')}`;
  const ids = await permissionIds(platformPrisma);
  const store = await platformPrisma.$transaction(async (tx) => {
    const created = await tx.store.create({ data: { name, slug, ...newTrial(now) }, select: { id: true, name: true } });
    await setUpStore(tx, created.id, ids);
    await tx.setting.update({ where: { storeId_key: { storeId: created.id, key: 'company.name' } }, data: { value: name } });
    return created;
  }, TX);

  let ownerId: string;
  try {
    const role = await platformPrisma.role.findUniqueOrThrow({
      where: { storeId_slug: { storeId: store.id, slug: OWNER_ROLE_SLUG } },
      select: { id: true },
    });
    // The administrator chose this password, so the owner replaces it at first sign-in.
    const created = await runAsProvisioning({ storeId: store.id, roleId: role.id, mustChangePassword: true }, () =>
      auth.api.signUpEmail({
        body: { name: input.owner.name, email, password: input.owner.password, username: input.owner.username },
      }),
    );
    if (!created?.user?.id) throw new ConflictError('The owner account could not be created.');
    ownerId = created.user.id;
    if (input.owner.phone?.trim()) {
      await platformPrisma.user.update({ where: { id: ownerId }, data: { phone: input.owner.phone.trim() } });
    }
  } catch (error) {
    await removeEmptyStore(store.id).catch((cleanup) => console.error('[platform] could not remove a half-created store', store.id, cleanup));
    if (error instanceof APIError) {
      const message = (error.body as { message?: string } | undefined)?.message ?? error.message;
      throw new ValidationError(message || 'The owner account could not be created.');
    }
    throw error;
  }

  await platformPrisma.$transaction(async (tx) => {
    const trial = newTrial(now);
    await audit(tx, actor, store, {
      action: 'CREATE',
      entity: 'Store',
      entityId: store.id,
      summary: `Store created with owner @${input.owner.username} (temporary password, must be changed at first sign-in); ${PLANS[trial.plan].name} trial until ${formatDate(trial.trialEndsAt)}`,
      changes: { after: { plan: trial.plan, status: trial.status, trialEndsAt: iso(trial.trialEndsAt) }, ownerId, ownerMustChangePassword: true },
    });
  }, TX);

  return { storeId: store.id, ownerId };
}

/** Undoes a store that never got an owner: only the setup rows exist. */
async function removeEmptyStore(storeId: string): Promise<void> {
  await platformPrisma.$transaction(async (tx) => {
    const users = await tx.user.count({ where: { storeId } });
    if (users > 0) throw new Error('store has accounts; not removing');
    await tx.rolePermission.deleteMany({ where: { role: { storeId } } });
    await tx.role.deleteMany({ where: { storeId } });
    await tx.setting.deleteMany({ where: { storeId } });
    await tx.warehouse.deleteMany({ where: { storeId } });
    await tx.store.delete({ where: { id: storeId } });
  }, TX);
}
