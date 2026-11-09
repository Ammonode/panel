import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { HttpError } from '../../lib/errors'
import { createInvoice } from './invoices'
import { addPeriod, fromCents, toCents } from './money'
import { getProductForSale } from './pricing'

type Service = typeof schema.services.$inferSelect

/** Share (0..1) of the current billing period that is still left. */
export function remainingFraction(expiresAt: Date, period: number, unit: string, now = new Date()) {
  const start = addPeriod(expiresAt, -period, unit)
  const total = expiresAt.getTime() - start.getTime()
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (expiresAt.getTime() - now.getTime()) / total))
}

/**
 * Recurring price (cents) of a service if it were on `productId`/`planId`,
 * keeping the customer's config answers that the new product also offers.
 */
async function recurringPriceFor(service: Service, productId: number, planId: number) {
  const sale = await getProductForSale(productId, service.currencyCode)
  const plan = sale.plans.find((p) => p.id === planId)
  if (!plan) throw new HttpError(422, 'This billing cycle is not available for that product', 'invalid')
  const answers = await db.query.serviceConfigs.findMany({
    where: eq(schema.serviceConfigs.serviceId, service.id),
  })
  let price = plan.price
  const kept: number[] = []
  for (const option of sale.configOptions) {
    const answer = answers.find((a) => a.configOptionId === option.id)
    if (!answer) continue
    kept.push(answer.id)
    const plans = answer.configValueId
      ? option.values.find((v) => v.id === answer.configValueId)?.plans
      : answer.value === '1'
        ? option.plans
        : []
    const match = plans?.find(
      (p) =>
        p.billingPeriod === plan.billingPeriod && p.billingUnit === plan.billingUnit && p.type === plan.type,
    )
    price += match?.price ?? 0
  }
  return { plan, price, keptConfigIds: kept, product: sale.product }
}

/** Upgrade/downgrade targets the admin allows for this service's product. */
export async function upgradeOptions(service: Service) {
  const current = await db.query.plans.findFirst({ where: eq(schema.plans.id, service.planId) })
  if (current?.type !== 'recurring' || !service.expiresAt || service.status !== 'active') return []
  const links = await db.query.productUpgrades.findMany({
    where: eq(schema.productUpgrades.productId, service.productId),
  })
  if (!links.length) return []
  const fraction = remainingFraction(service.expiresAt, current.billingPeriod, current.billingUnit)
  const out = []
  for (const link of links) {
    const sale = await getProductForSale(link.upgradeId, service.currencyCode)
    if (sale.product.hidden && sale.product.id !== service.productId) continue
    // Only plans with the same billing cycle: the due date stays the same.
    for (const plan of sale.plans.filter(
      (p) =>
        p.type === 'recurring' &&
        p.billingPeriod === current.billingPeriod &&
        p.billingUnit === current.billingUnit,
    )) {
      const q = await recurringPriceFor(service, sale.product.id, plan.id)
      const due = Math.round((q.price - toCents(service.price)) * fraction)
      out.push({
        productId: sale.product.id,
        name: sale.product.name,
        description: sale.product.description,
        planId: plan.id,
        plan: plan.label,
        price: fromCents(q.price),
        dueNow: fromCents(Math.max(0, due)),
        downgrade: due < 0,
      })
    }
  }
  return out
}

/** Starts an upgrade: invoices the prorated difference, or applies a downgrade right away. */
export async function requestUpgrade(service: Service, productId: number, planId: number) {
  const options = await upgradeOptions(service)
  const choice = options.find((o) => o.productId === productId && o.planId === planId)
  if (!choice) throw new HttpError(422, 'This upgrade is not available', 'invalid')
  const pending = await db.query.serviceUpgrades.findFirst({
    where: and(
      eq(schema.serviceUpgrades.serviceId, service.id),
      eq(schema.serviceUpgrades.status, 'pending'),
    ),
  })
  if (pending?.invoiceId) {
    // An upgrade whose invoice was cancelled must not block new ones.
    const inv = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, pending.invoiceId) })
    if (inv?.status !== 'pending') {
      await db
        .update(schema.serviceUpgrades)
        .set({ status: 'cancelled' })
        .where(eq(schema.serviceUpgrades.id, pending.id))
    } else
      throw new HttpError(
        409,
        'An upgrade is already waiting for payment. Pay its invoice first.',
        'conflict',
        { invoiceId: String(inv.id) },
      )
  } else if (pending)
    throw new HttpError(
      409,
      'An upgrade is already waiting for payment. Pay or cancel its invoice first.',
      'conflict',
    )

  // Let the provisioner refuse upgrades it cannot fulfil before money is taken.
  const { getProvisioner } = await import('../../extensions/registry')
  const target = await db.query.products.findFirst({ where: eq(schema.products.id, productId) })
  const p = getProvisioner(target?.serverExtension)
  if (p?.provisioner.checkUpgrade) {
    const { serviceContext } = await import('./lifecycle')
    const { keptConfigIds } = await recurringPriceFor(service, productId, planId)
    const ctx = await serviceContext({ ...service, productId, planId }, keptConfigIds)
    try {
      await p.provisioner.checkUpgrade(ctx)
    } catch (e) {
      throw new HttpError(422, (e as Error).message, 'upgrade_unavailable')
    }
  }

  const [upgrade] = await db
    .insert(schema.serviceUpgrades)
    .values({ serviceId: service.id, productId, planId, status: 'pending' })
    .returning()
  const due = toCents(choice.dueNow)
  if (due <= 0) {
    await applyUpgrade(upgrade!.id)
    return { applied: true as const, invoiceId: null }
  }
  const invoice = await createInvoice({
    userId: service.userId,
    currency: service.currencyCode,
    dueAt: new Date(),
    items: [
      {
        description: `Upgrade to ${choice.name} (${choice.plan}), prorated until ${service.expiresAt!.toISOString().slice(0, 10)}`,
        price: due,
        referenceType: 'service_upgrade',
        referenceId: upgrade!.id,
      },
    ],
  })
  await db
    .update(schema.serviceUpgrades)
    .set({ invoiceId: invoice.id })
    .where(eq(schema.serviceUpgrades.id, upgrade!.id))
  await logActivity({
    event: 'billing:service.upgrade-requested',
    actorId: service.userId,
    subject: { type: 'service', id: service.id },
    properties: { productId, planId, due: choice.dueNow },
  })
  return { applied: false as const, invoiceId: invoice.id }
}

/** Switches the service to the new product/plan and resizes it through the provisioner. */
export async function applyUpgrade(upgradeId: number) {
  const upgrade = await db.query.serviceUpgrades.findFirst({
    where: eq(schema.serviceUpgrades.id, upgradeId),
  })
  if (upgrade?.status !== 'pending') return
  const service = (await db.query.services.findFirst({ where: eq(schema.services.id, upgrade.serviceId) }))!
  const q = await recurringPriceFor(service, upgrade.productId, upgrade.planId)
  await db.transaction(async (tx) => {
    // Answers for options the new product does not have would keep overriding its resources.
    const answers = await tx.query.serviceConfigs.findMany({
      where: eq(schema.serviceConfigs.serviceId, service.id),
    })
    const drop = answers.filter((a) => !q.keptConfigIds.includes(a.id)).map((a) => a.id)
    if (drop.length) await tx.delete(schema.serviceConfigs).where(inArray(schema.serviceConfigs.id, drop))
    await tx
      .update(schema.services)
      .set({
        productId: upgrade.productId,
        planId: upgrade.planId,
        price: fromCents(q.price),
        // A coupon does not carry over to a different product.
        couponId: null,
        properties: { ...service.properties, fullPrice: fromCents(q.price), couponCyclesLeft: null },
      })
      .where(eq(schema.services.id, service.id))
    await tx
      .update(schema.serviceUpgrades)
      .set({ status: 'completed' })
      .where(eq(schema.serviceUpgrades.id, upgradeId))
  })
  const updated = (await db.query.services.findFirst({ where: eq(schema.services.id, service.id) }))!
  const { getProvisioner } = await import('../../extensions/registry')
  const { serviceContext } = await import('./lifecycle')
  const p = getProvisioner(q.product.serverExtension)
  if (p?.provisioner.upgrade) await p.provisioner.upgrade(await serviceContext(updated))
  await logActivity({
    event: 'billing:service.upgraded',
    actorId: service.userId,
    subject: { type: 'service', id: service.id },
    properties: { productId: upgrade.productId, planId: upgrade.planId },
  })
}
