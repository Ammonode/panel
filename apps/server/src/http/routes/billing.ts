import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { config } from '../../config'
import { db, schema } from '../../db'
import { getGateway, getProvisioner } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { HttpError, notFound } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { checkout } from '../../services/billing/checkout'
import { createInvoice, invoiceWithItems, payWithCredits } from '../../services/billing/invoices'
import { serviceContext } from '../../services/billing/lifecycle'
import { describePeriod, fromCents, toCents } from '../../services/billing/money'
import { getCurrency } from '../../services/billing/pricing'
import { requestUpgrade, upgradeOptions } from '../../services/billing/upgrades'
import { clientIp, requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'
import { validate } from '../validate'
import { cartItem } from './store'

const intId = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}

export const billingRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .post(
    '/checkout',
    validate(
      'json',
      z.object({
        items: z.array(cartItem).min(1).max(50),
        couponCode: z.string().max(64).nullish(),
        currency: z.string().length(3).optional(),
        gateway: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json')
      if ((await getSetting('auth.require_email_verification')) && !c.get('user')!.emailVerifiedAt) {
        throw new HttpError(403, 'Please confirm your email address before ordering.', 'email_unverified')
      }
      const { currency } = await getCurrency(body.currency)
      const result = await checkout(c.get('user')!.id, {
        items: body.items,
        couponCode: body.couponCode,
        currency: currency.code,
      })
      return c.json({ data: result }, 201)
    },
  )

  // ── Services ─────────────────────────────────────────────
  .get('/services', async (c) => {
    const rows = await db
      .select({ service: schema.services, product: { name: schema.products.name }, plan: schema.plans })
      .from(schema.services)
      .innerJoin(schema.products, eq(schema.products.id, schema.services.productId))
      .innerJoin(schema.plans, eq(schema.plans.id, schema.services.planId))
      .where(eq(schema.services.userId, c.get('user')!.id))
      .orderBy(desc(schema.services.id))
    return c.json({
      data: rows.map((r) => ({
        id: r.service.id,
        product: r.product.name,
        status: r.service.status,
        price: r.service.price,
        currency: r.service.currencyCode,
        cycle:
          r.plan.type === 'recurring'
            ? describePeriod(r.plan.billingPeriod, r.plan.billingUnit)
            : r.plan.type === 'free'
              ? 'Free'
              : 'One time',
        expiresAt: r.service.expiresAt,
        createdAt: r.service.createdAt,
      })),
    })
  })
  .get('/services/:id', async (c) => {
    const service = await db.query.services.findFirst({
      where: and(
        eq(schema.services.id, intId(c.req.param('id'))),
        eq(schema.services.userId, c.get('user')!.id),
      ),
    })
    if (!service) throw notFound('Service')
    const product = (await db.query.products.findFirst({ where: eq(schema.products.id, service.productId) }))!
    const plan = (await db.query.plans.findFirst({ where: eq(schema.plans.id, service.planId) }))!
    const ctx = await serviceContext(service)
    const p = getProvisioner(product.serverExtension)
    const loginUrl =
      service.status === 'active' && p?.provisioner.loginUrl
        ? await p.provisioner.loginUrl(ctx).catch(() => null)
        : null
    // Human readable answers ("Memory: 2 GB") for the customer.
    const configRows = await db.query.serviceConfigs.findMany({
      where: eq(schema.serviceConfigs.serviceId, service.id),
    })
    const optionRows = configRows.length
      ? await db.query.configOptions.findMany({
          where: inArray(
            schema.configOptions.id,
            configRows.flatMap((r) => [r.configOptionId, ...(r.configValueId ? [r.configValueId] : [])]),
          ),
        })
      : []
    const configs = configRows.map((r) => {
      const option = optionRows.find((o) => o.id === r.configOptionId)
      const value = r.configValueId
        ? optionRows.find((o) => o.id === r.configValueId)?.name
        : option?.type === 'checkbox'
          ? r.value === '1'
            ? 'Yes'
            : 'No'
          : r.value
      return { name: option?.name ?? 'Option', value: value || 'Default' }
    })
    const cancellation = await db.query.serviceCancellations.findFirst({
      where: eq(schema.serviceCancellations.serviceId, service.id),
    })
    const items = await db.query.invoiceItems.findMany({
      where: and(
        eq(schema.invoiceItems.referenceType, 'service'),
        eq(schema.invoiceItems.referenceId, service.id),
      ),
    })
    const invoices = items.length
      ? await db.query.invoices.findMany({
          where: inArray(
            schema.invoices.id,
            items.map((i) => i.invoiceId),
          ),
          orderBy: desc(schema.invoices.id),
        })
      : []
    return c.json({
      data: {
        id: service.id,
        product: { id: product.id, name: product.name, description: product.description },
        status: service.status,
        price: service.price,
        currency: service.currencyCode,
        cycle: plan.type === 'recurring' ? describePeriod(plan.billingPeriod, plan.billingUnit) : plan.type,
        expiresAt: service.expiresAt,
        createdAt: service.createdAt,
        configs,
        loginUrl,
        setupFailed: service.status === 'pending' && !!service.properties.provisionError,
        cancellation: cancellation
          ? { type: cancellation.type, reason: cancellation.reason, createdAt: cancellation.createdAt }
          : null,
        invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, dueAt: i.dueAt })),
      },
    })
  })
  .post(
    '/services/:id/cancel',
    validate(
      'json',
      z.object({ type: z.enum(['immediate', 'end_of_period']), reason: z.string().max(1000).optional() }),
    ),
    async (c) => {
      const service = await db.query.services.findFirst({
        where: and(
          eq(schema.services.id, intId(c.req.param('id'))),
          eq(schema.services.userId, c.get('user')!.id),
        ),
      })
      if (!service || service.status === 'cancelled') throw notFound('Service')
      const existing = await db.query.serviceCancellations.findFirst({
        where: eq(schema.serviceCancellations.serviceId, service.id),
      })
      if (existing) throw new HttpError(409, 'A cancellation was already requested', 'conflict')
      await db.insert(schema.serviceCancellations).values({ serviceId: service.id, ...c.req.valid('json') })
      await logActivity({
        event: 'billing:service.cancel-requested',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'service', id: service.id },
        properties: c.req.valid('json'),
      })
      if (c.req.valid('json').type === 'immediate') {
        const { terminateService } = await import('../../services/billing/lifecycle')
        await terminateService(service.id, 'cancelled by customer')
      }
      return c.json({ ok: true })
    },
  )

  .get('/services/:id/upgrades', async (c) => {
    const service = await db.query.services.findFirst({
      where: and(
        eq(schema.services.id, intId(c.req.param('id'))),
        eq(schema.services.userId, c.get('user')!.id),
      ),
    })
    if (!service) throw notFound('Service')
    return c.json({ data: await upgradeOptions(service) })
  })
  .post(
    '/services/:id/upgrade',
    validate('json', z.object({ productId: z.number().int(), planId: z.number().int() })),
    async (c) => {
      const service = await db.query.services.findFirst({
        where: and(
          eq(schema.services.id, intId(c.req.param('id'))),
          eq(schema.services.userId, c.get('user')!.id),
        ),
      })
      if (!service) throw notFound('Service')
      const { productId, planId } = c.req.valid('json')
      return c.json({ data: await requestUpgrade(service, productId, planId) })
    },
  )

  // ── Invoices ─────────────────────────────────────────────
  .get('/invoices', async (c) => {
    const status = c.req.query('status')
    const invoices = await db.query.invoices.findMany({
      where: and(
        eq(schema.invoices.userId, c.get('user')!.id),
        status ? eq(schema.invoices.status, status) : undefined,
      ),
      orderBy: desc(schema.invoices.id),
      limit: 100,
    })
    const items = invoices.length
      ? await db.query.invoiceItems.findMany({
          where: inArray(
            schema.invoiceItems.invoiceId,
            invoices.map((i) => i.id),
          ),
        })
      : []
    return c.json({
      data: invoices.map((i) => {
        const own = items.filter((x) => x.invoiceId === i.id)
        return {
          ...i,
          total: fromCents(own.reduce((s, x) => s + toCents(x.price) * x.quantity, 0)),
          description: own[0]?.description.split('\n')[0] ?? null,
        }
      }),
    })
  })
  .get('/invoices/:id', async (c) => {
    const invoice = await invoiceWithItems(intId(c.req.param('id')))
    if (!invoice || invoice.userId !== c.get('user')!.id) throw notFound('Invoice')
    return c.json({ data: invoice })
  })
  .post('/invoices/:id/pay', validate('json', z.object({ gateway: z.string() })), async (c) => {
    const user = c.get('user')!
    const invoice = await invoiceWithItems(intId(c.req.param('id')))
    if (!invoice || invoice.userId !== user.id) throw notFound('Invoice')
    if (invoice.status !== 'pending') throw new HttpError(422, 'This invoice cannot be paid', 'invalid')
    const { gateway: gatewayId } = c.req.valid('json')

    if (gatewayId === 'credits') {
      const used = await payWithCredits(user.id, invoice.id)
      const after = await invoiceWithItems(invoice.id)
      return c.json({
        data: { paid: after!.status === 'paid', usedCredits: fromCents(used), remaining: after!.remaining },
      })
    }
    const g = getGateway(gatewayId)
    if (!g) throw new HttpError(422, 'This payment method is not available', 'invalid')
    const invoiceUrl = `${config.url}/invoices/${invoice.id}`
    try {
      const result = await g.gateway.pay({
        invoice: {
          id: invoice.id,
          number: invoice.number,
          userId: user.id,
          total: { amount: invoice.remaining, currency: invoice.currencyCode },
          description: invoice.items.map((i) => i.description.split('\n')[0]).join(', '),
        },
        user: {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
        },
        returnUrl: `${invoiceUrl}?paid=1`,
        cancelUrl: invoiceUrl,
        extensionUrl: `${config.url}/api/extensions/${gatewayId}`,
        settings: g.ext.settings,
      })
      return c.json({ data: result })
    } catch (e) {
      console.error(`Gateway ${gatewayId} failed for invoice ${invoice.id}:`, e)
      throw new HttpError(
        502,
        `The payment provider returned an error: ${(e as Error).message}`,
        'gateway_error',
      )
    }
  })

  // ── Credits ──────────────────────────────────────────────
  .post(
    '/credits',
    validate('json', z.object({ amount: z.number().positive(), currency: z.string().length(3).optional() })),
    async (c) => {
      if (!(await getSetting('billing.credits_enabled')))
        throw new HttpError(422, 'Credits are disabled', 'invalid')
      const min = await getSetting('billing.credits_min_deposit')
      const max = await getSetting('billing.credits_max_deposit')
      const { amount } = c.req.valid('json')
      if (amount < min || amount > max)
        throw new HttpError(422, `You can add between ${min} and ${max}`, 'invalid', {
          amount: `Between ${min} and ${max}`,
        })
      const { currency } = await getCurrency(c.req.valid('json').currency)
      const invoice = await createInvoice({
        userId: c.get('user')!.id,
        currency: currency.code,
        dueAt: new Date(),
        items: [{ description: 'Account credit', price: toCents(amount), referenceType: 'credit' }],
      })
      return c.json({ data: { invoiceId: invoice.id } }, 201)
    },
  )
