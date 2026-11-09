import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { HttpError } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { fromCents, toCents } from './money'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

export type NewInvoiceItem = {
  description: string
  price: number // cents per unit, may be negative (discounts)
  quantity?: number
  referenceType?: 'service' | 'service_upgrade' | 'credit' | 'tax' | 'discount' | 'custom'
  referenceId?: number | null
}

async function formatNumber(id: number) {
  const format = await getSetting('billing.invoice_number_format')
  const padding = await getSetting('billing.invoice_number_padding')
  return format
    .replace('{number}', String(id).padStart(padding, '0'))
    .replace('{year}', String(new Date().getUTCFullYear()))
}

export async function createInvoice(
  input: { userId: number; currency: string; dueAt: Date; items: NewInvoiceItem[] },
  tx: Executor = db,
) {
  const [invoice] = await tx
    .insert(schema.invoices)
    .values({ userId: input.userId, currencyCode: input.currency, dueAt: input.dueAt, status: 'pending' })
    .returning()
  const number = await formatNumber(invoice!.id)
  await tx.update(schema.invoices).set({ number }).where(eq(schema.invoices.id, invoice!.id))
  if (input.items.length) {
    await tx.insert(schema.invoiceItems).values(
      input.items.map((i) => ({
        invoiceId: invoice!.id,
        description: i.description,
        price: fromCents(i.price),
        quantity: i.quantity ?? 1,
        referenceType: i.referenceType ?? 'custom',
        referenceId: i.referenceId ?? null,
      })),
    )
  }
  return { ...invoice!, number }
}

/** Total in cents. */
export async function invoiceTotal(invoiceId: number, tx: Executor = db) {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${schema.invoiceItems.price} * ${schema.invoiceItems.quantity}), 0)`,
    })
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, invoiceId))
  return toCents(row!.total)
}

export async function invoicePaid(invoiceId: number, tx: Executor = db) {
  const [row] = await tx
    .select({ paid: sql<string>`coalesce(sum(${schema.invoiceTransactions.amount}), 0)` })
    .from(schema.invoiceTransactions)
    .where(
      and(
        eq(schema.invoiceTransactions.invoiceId, invoiceId),
        eq(schema.invoiceTransactions.status, 'succeeded'),
      ),
    )
  return toCents(row!.paid)
}

export async function invoiceSummary(invoiceId: number) {
  const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
  if (!invoice) return null
  const total = await invoiceTotal(invoiceId)
  const paid = await invoicePaid(invoiceId)
  return {
    id: invoice.id,
    status: invoice.status,
    currency: invoice.currencyCode,
    total: fromCents(total),
    /** What is still to be paid. */
    remaining: fromCents(Math.max(0, total - paid)),
    userId: invoice.userId,
  }
}

/**
 * Records a payment. Idempotent per (gateway, transactionId), so a webhook
 * delivered twice does not pay twice. When fully paid the invoice items are
 * processed (services activated/renewed, credit added, upgrades applied).
 */
export async function markInvoicePaid(
  invoiceId: number,
  t: { gateway: string | null; transactionId?: string | null; amount: string; fee?: string },
) {
  const paidNow = await db.transaction(async (tx) => {
    // Serialise payments for the same invoice.
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`)
    const invoice = await tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
    if (!invoice) throw new HttpError(404, 'Invoice not found', 'not_found')
    if (t.transactionId) {
      const dup = await tx.query.invoiceTransactions.findFirst({
        where: and(
          eq(schema.invoiceTransactions.transactionId, t.transactionId),
          eq(schema.invoiceTransactions.invoiceId, invoiceId),
        ),
      })
      if (dup) return false
    }
    await tx.insert(schema.invoiceTransactions).values({
      invoiceId,
      gateway: t.gateway,
      transactionId: t.transactionId ?? null,
      amount: t.amount,
      fee: t.fee ?? '0',
      status: 'succeeded',
    })
    if (invoice.status !== 'pending') return false
    const total = await invoiceTotal(invoiceId, tx)
    const paid = await invoicePaid(invoiceId, tx)
    if (paid < total) return false
    await tx
      .update(schema.invoices)
      .set({ status: 'paid', paidAt: new Date() })
      .where(eq(schema.invoices.id, invoiceId))
    return true
  })
  if (paidNow) await processPaidInvoice(invoiceId)
}

async function processPaidInvoice(invoiceId: number) {
  const invoice = (await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }))!
  const items = await db.query.invoiceItems.findMany({ where: eq(schema.invoiceItems.invoiceId, invoiceId) })
  const { activateOrRenew } = await import('./lifecycle')
  const { applyUpgrade } = await import('./upgrades')
  for (const item of items) {
    try {
      if (item.referenceType === 'service' && item.referenceId) await activateOrRenew(item.referenceId)
      if (item.referenceType === 'service_upgrade' && item.referenceId) await applyUpgrade(item.referenceId)
      if (item.referenceType === 'credit')
        await addCredits(invoice.userId, invoice.currencyCode, toCents(item.price) * item.quantity)
    } catch (e) {
      console.error(`Failed to process item ${item.id} of invoice ${invoiceId}:`, e)
      await logActivity({
        event: 'billing:invoice.item-failed',
        subject: { type: 'invoice', id: invoiceId },
        properties: { item: item.id, error: (e as Error).message },
      })
    }
  }
  await logActivity({
    event: 'billing:invoice.paid',
    actorId: invoice.userId,
    subject: { type: 'invoice', id: invoiceId },
  })
  const { emit } = await import('../../extensions/registry')
  await emit('invoice.paid', { invoiceId, userId: invoice.userId })
  const { invoicePaid } = await import('../notify')
  await invoicePaid(invoiceId)
}

export async function addCredits(userId: number, currency: string, cents: number, tx: Executor = db) {
  // Atomic update of the JSON balance.
  await tx.execute(sql`
    update users set credits = jsonb_set(
      credits, ${`{${currency}}`}::text[],
      to_jsonb(round((coalesce((credits->>${currency})::numeric, 0) + ${fromCents(cents)}::numeric), 2)::text)
    ) where id = ${userId}`)
}

/** Pays as much as possible of an invoice from the user's credit balance. */
export async function payWithCredits(userId: number, invoiceId: number) {
  if (!(await getSetting('billing.credits_enabled')))
    throw new HttpError(422, 'Credits are disabled', 'invalid')
  const summary = await invoiceSummary(invoiceId)
  if (!summary || summary.userId !== userId) throw new HttpError(404, 'Invoice not found', 'not_found')
  if (summary.status !== 'pending') throw new HttpError(422, 'This invoice is not pending', 'invalid')
  const items = await db.query.invoiceItems.findMany({ where: eq(schema.invoiceItems.invoiceId, invoiceId) })
  if (items.some((i) => i.referenceType === 'credit'))
    throw new HttpError(422, 'Credit top-ups cannot be paid with credit', 'invalid')

  const amount = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`)
    const user = (await tx.query.users.findFirst({ where: eq(schema.users.id, userId) }))!
    const balance = toCents(user.credits[summary.currency] ?? '0')
    const use = Math.min(balance, toCents(summary.remaining))
    if (use <= 0) throw new HttpError(422, 'Not enough credit', 'insufficient_credit')
    await addCredits(userId, summary.currency, -use, tx)
    return use
  })
  await markInvoicePaid(invoiceId, { gateway: null, transactionId: null, amount: fromCents(amount) })
  return amount
}

export async function cancelInvoice(invoiceId: number) {
  await db
    .update(schema.invoices)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.status, 'pending')))
}

export async function invoiceWithItems(invoiceId: number) {
  const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
  if (!invoice) return null
  const items = await db.query.invoiceItems.findMany({
    where: eq(schema.invoiceItems.invoiceId, invoiceId),
    orderBy: schema.invoiceItems.id,
  })
  const transactions = await db.query.invoiceTransactions.findMany({
    where: eq(schema.invoiceTransactions.invoiceId, invoiceId),
  })
  const total = items.reduce((s, i) => s + toCents(i.price) * i.quantity, 0)
  const paid = transactions.filter((t) => t.status === 'succeeded').reduce((s, t) => s + toCents(t.amount), 0)
  return {
    ...invoice,
    items: items.map((i) => ({
      id: i.id,
      description: i.description,
      price: i.price,
      quantity: i.quantity,
      total: fromCents(toCents(i.price) * i.quantity),
      type: i.referenceType,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      gateway: t.gateway ?? 'credit',
      transactionId: t.transactionId,
      amount: t.amount,
      status: t.status,
      createdAt: t.createdAt,
    })),
    total: fromCents(total),
    paid: fromCents(paid),
    remaining: fromCents(Math.max(0, total - paid)),
  }
}
