import { and, eq, gt, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm'
import { db, schema } from '../../db'
import { getSetting } from '../../lib/settings'
import { invoiceCreated, invoiceReminder } from '../notify'
import { registerTask } from '../scheduler'
import { cancelInvoice, createInvoice, invoiceSummary, payWithCredits } from './invoices'
import { suspendService, terminateService } from './lifecycle'
import { toCents } from './money'

const DAY = 86_400_000

/** Pending invoice that renews this service, if any. */
async function openRenewal(serviceId: number) {
  const items = await db.query.invoiceItems.findMany({
    where: and(
      eq(schema.invoiceItems.referenceType, 'service'),
      eq(schema.invoiceItems.referenceId, serviceId),
    ),
  })
  if (!items.length) return null
  return db.query.invoices.findFirst({
    where: and(
      inArray(
        schema.invoices.id,
        items.map((i) => i.invoiceId),
      ),
      eq(schema.invoices.status, 'pending'),
    ),
  })
}

/** Creates renewal invoices N days before services expire. */
export async function generateRenewalInvoices() {
  const days = await getSetting('billing.invoice_days_before_due')
  const due = await db.query.services.findMany({
    where: and(
      inArray(schema.services.status, ['active', 'suspended']),
      isNotNull(schema.services.expiresAt),
      lte(schema.services.expiresAt, new Date(Date.now() + days * DAY)),
    ),
  })
  for (const service of due) {
    if (await openRenewal(service.id)) continue
    const plan = await db.query.plans.findFirst({ where: eq(schema.plans.id, service.planId) })
    if (plan?.type !== 'recurring') continue
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, service.productId) })
    const props = service.properties as { fullPrice?: string; couponCyclesLeft?: number | null }

    // Discounted renewals run out after the coupon's cycle count.
    let price = toCents(service.price)
    if (typeof props.couponCyclesLeft === 'number') {
      if (props.couponCyclesLeft <= 0 && props.fullPrice) {
        price = toCents(props.fullPrice)
        await db
          .update(schema.services)
          .set({ price: props.fullPrice, properties: { ...service.properties, couponCyclesLeft: null } })
          .where(eq(schema.services.id, service.id))
      } else {
        await db
          .update(schema.services)
          .set({ properties: { ...service.properties, couponCyclesLeft: props.couponCyclesLeft - 1 } })
          .where(eq(schema.services.id, service.id))
      }
    }
    const until = service.expiresAt!.toISOString().slice(0, 10)
    const invoice = await createInvoice({
      userId: service.userId,
      currency: service.currencyCode,
      dueAt: service.expiresAt!,
      items: [
        {
          description: `${product?.name ?? 'Service'} renewal (until ${until})`,
          price: price * service.quantity,
          referenceType: 'service',
          referenceId: service.id,
        },
      ],
    })
    await invoiceCreated(invoice.id)
  }
}

/** Sends one reminder per invoice a few days before it is due. */
export async function sendReminders() {
  const days = await getSetting('billing.reminder_days_before_due')
  const due = await db.query.invoices.findMany({
    where: and(
      eq(schema.invoices.status, 'pending'),
      isNull(schema.invoices.reminderSentAt),
      lte(schema.invoices.dueAt, new Date(Date.now() + days * DAY)),
      gt(schema.invoices.dueAt, new Date()),
    ),
  })
  for (const invoice of due) {
    await db
      .update(schema.invoices)
      .set({ reminderSentAt: new Date() })
      .where(eq(schema.invoices.id, invoice.id))
    await invoiceReminder(invoice.id)
  }
}

/** Suspends services whose renewal is overdue and terminates them later. */
export async function enforceOverdue() {
  const suspendAfter = await getSetting('billing.suspend_after_days')
  const terminateAfter = await getSetting('billing.terminate_after_days')
  const now = Date.now()

  const overdue = await db.query.services.findMany({
    where: and(
      eq(schema.services.status, 'active'),
      isNotNull(schema.services.expiresAt),
      lt(schema.services.expiresAt, new Date(now - suspendAfter * DAY)),
    ),
  })
  for (const s of overdue)
    await suspendService(s.id).catch((e) => console.error(`suspend service ${s.id}:`, e))

  const expired = await db.query.services.findMany({
    where: and(
      eq(schema.services.status, 'suspended'),
      isNotNull(schema.services.expiresAt),
      lt(schema.services.expiresAt, new Date(now - terminateAfter * DAY)),
    ),
  })
  for (const s of expired)
    await terminateService(s.id).catch((e) => console.error(`terminate service ${s.id}:`, e))
}

/** Processes cancellation requests that are due. */
export async function processCancellations() {
  const requests = await db.query.serviceCancellations.findMany()
  for (const r of requests) {
    const s = await db.query.services.findFirst({ where: eq(schema.services.id, r.serviceId) })
    if (!s || s.status === 'cancelled') continue
    if (r.type === 'immediate' || !s.expiresAt || s.expiresAt.getTime() <= Date.now()) {
      await terminateService(s.id, 'cancelled by customer').catch((e) =>
        console.error(`cancel service ${s.id}:`, e),
      )
    }
  }
}

/** Cancels orders that were never paid. */
export async function cancelStaleOrders() {
  const days = await getSetting('billing.cancel_pending_orders_after_days')
  const stale = await db.query.services.findMany({
    where: and(
      eq(schema.services.status, 'pending'),
      lt(schema.services.createdAt, new Date(Date.now() - days * DAY)),
    ),
  })
  for (const s of stale) {
    const inv = await openRenewal(s.id)
    if (inv) await cancelInvoice(inv.id)
    await db.update(schema.services).set({ status: 'cancelled' }).where(eq(schema.services.id, s.id))
  }
}

/**
 * Pays due renewal invoices from the customer's credit balance when it covers
 * the full amount (partial payments are left to the customer).
 */
export async function chargeCredits() {
  if (!(await getSetting('billing.credits_enabled'))) return
  const due = await db.query.invoices.findMany({
    where: and(eq(schema.invoices.status, 'pending'), lte(schema.invoices.dueAt, new Date())),
  })
  for (const invoice of due) {
    const items = await db.query.invoiceItems.findMany({
      where: eq(schema.invoiceItems.invoiceId, invoice.id),
    })
    if (!items.some((i) => i.referenceType === 'service') || items.some((i) => i.referenceType === 'credit'))
      continue
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, invoice.userId) })
    const summary = await invoiceSummary(invoice.id)
    if (!user || !summary) continue
    if (toCents(user.credits[invoice.currencyCode] ?? '0') < toCents(summary.remaining)) continue
    await payWithCredits(user.id, invoice.id).catch((e) =>
      console.error(`credit charge invoice ${invoice.id}:`, e.message),
    )
  }
}

export function registerBillingJobs() {
  registerTask('billing:credits', '*/10 * * * *', chargeCredits)
  registerTask('billing:reminders', '15 * * * *', sendReminders)
  registerTask('billing:renewals', '*/10 * * * *', generateRenewalInvoices)
  registerTask('billing:overdue', '5,35 * * * *', enforceOverdue)
  registerTask('billing:cancellations', '*/15 * * * *', processCancellations)
  registerTask('billing:stale-orders', '20 * * * *', cancelStaleOrders)
}
