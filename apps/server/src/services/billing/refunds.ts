import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { getGateway } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { HttpError } from '../../lib/errors'
import { addCredits } from './invoices'
import { fromCents, toCents } from './money'

export type RefundMethod = 'gateway' | 'credit' | 'manual'

/** Already refunded amount (cents) of one transaction. */
async function refundedFor(transactionId: number) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(-${schema.invoiceTransactions.amount}), 0)` })
    .from(schema.invoiceTransactions)
    .where(
      and(
        eq(schema.invoiceTransactions.status, 'refunded'),
        sql`${schema.invoiceTransactions.transactionId} = ${`refund-of:${transactionId}`}`,
      ),
    )
  return toCents(row!.total)
}

/**
 * Refunds (part of) a payment. Refunds are stored as negative transactions
 * linked to the original, so they can never exceed what was paid.
 */
export async function refundTransaction(
  transactionId: number,
  amount: string,
  method: RefundMethod,
  actorId: number,
) {
  const tx = await db.query.invoiceTransactions.findFirst({
    where: eq(schema.invoiceTransactions.id, transactionId),
  })
  if (!tx || tx.status !== 'succeeded' || toCents(tx.amount) <= 0)
    throw new HttpError(404, 'Payment not found', 'not_found')
  const invoice = (await db.query.invoices.findFirst({ where: eq(schema.invoices.id, tx.invoiceId) }))!
  const cents = toCents(amount)
  const left = toCents(tx.amount) - (await refundedFor(tx.id))
  if (cents <= 0) throw new HttpError(422, 'Enter an amount to refund', 'invalid')
  if (cents > left)
    throw new HttpError(422, `At most ${fromCents(left)} can still be refunded for this payment`, 'invalid')

  if (method === 'gateway') {
    if (!tx.gateway || !tx.transactionId)
      throw new HttpError(
        422,
        'This payment was not made through a gateway. Refund it as credit instead.',
        'invalid',
      )
    const g = getGateway(tx.gateway)
    if (!g?.gateway.refund)
      throw new HttpError(422, `${tx.gateway} does not support refunds from the panel`, 'invalid')
    try {
      await g.gateway.refund({
        transactionId: tx.transactionId,
        amount: { amount: fromCents(cents), currency: invoice.currencyCode },
        settings: g.ext.settings,
      })
    } catch (e) {
      throw new HttpError(
        502,
        `The payment provider refused the refund: ${(e as Error).message}`,
        'gateway_error',
      )
    }
  }
  if (method === 'credit') await addCredits(invoice.userId, invoice.currencyCode, cents)

  await db.insert(schema.invoiceTransactions).values({
    invoiceId: invoice.id,
    gateway: method === 'gateway' ? tx.gateway : method,
    transactionId: `refund-of:${tx.id}`,
    amount: fromCents(-cents),
    status: 'refunded',
  })
  // Fully refunded invoices are marked as such.
  const [paid] = await db
    .select({
      paid: sql<string>`coalesce(sum(case when ${schema.invoiceTransactions.status} = 'succeeded' then ${schema.invoiceTransactions.amount} else 0 end), 0)`,
      refunded: sql<string>`coalesce(sum(case when ${schema.invoiceTransactions.status} = 'refunded' then -${schema.invoiceTransactions.amount} else 0 end), 0)`,
    })
    .from(schema.invoiceTransactions)
    .where(eq(schema.invoiceTransactions.invoiceId, invoice.id))
  if (toCents(paid!.refunded) >= toCents(paid!.paid))
    await db.update(schema.invoices).set({ status: 'refunded' }).where(eq(schema.invoices.id, invoice.id))
  await logActivity({
    event: 'admin:invoice.refund',
    actorId,
    subject: { type: 'invoice', id: invoice.id },
    properties: { transactionId, amount: fromCents(cents), method },
  })
}
