import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { getExtension, getProvisioner, listExtensions, saveExtension } from '../../../extensions/registry'
import { logActivity } from '../../../lib/activity'
import { HttpError, notFound } from '../../../lib/errors'
import { defaultSettings, getSettings, setSettings } from '../../../lib/settings'
import { createInvoice, invoiceWithItems, markInvoicePaid } from '../../../services/billing/invoices'
import {
  activateOrRenew,
  suspendService,
  terminateService,
  unsuspendService,
} from '../../../services/billing/lifecycle'
import { fromCents, toCents } from '../../../services/billing/money'
import { refundTransaction } from '../../../services/billing/refunds'
import { clientIp, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { onlyProvided, validate } from '../../validate'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const intId = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}
const slug = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
const money = z.union([z.string(), z.number()]).transform((v) => fromCents(toCents(v)))

const planBody = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(191),
  type: z.enum(['free', 'one-time', 'recurring']),
  billingPeriod: z.number().int().min(1).max(120).default(1),
  billingUnit: z.enum(['day', 'week', 'month', 'year']).default('month'),
  prices: z
    .array(z.object({ currency: z.string().length(3), price: money, setupFee: money.default('0.00') }))
    .default([]),
})
type PlanInput = z.infer<typeof planBody>

/** Replaces the plans of a priceable, keeping ids of plans that still exist. */
async function syncPlans(tx: Tx, type: 'product' | 'config_option', priceableId: number, plans: PlanInput[]) {
  const existing = await tx.query.plans.findMany({
    where: and(eq(schema.plans.priceableType, type), eq(schema.plans.priceableId, priceableId)),
  })
  const keep = plans.filter((p) => p.id && existing.some((e) => e.id === p.id)).map((p) => p.id!)
  const remove = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id)
  if (remove.length) {
    const [used] = await tx
      .select({ n: count() })
      .from(schema.services)
      .where(inArray(schema.services.planId, remove))
    if (used!.n > 0)
      throw new HttpError(
        409,
        'A removed plan is still used by services. Hide the product instead.',
        'in_use',
      )
    await tx.delete(schema.plans).where(inArray(schema.plans.id, remove))
  }
  for (const [sort, p] of plans.entries()) {
    const values = {
      priceableType: type,
      priceableId,
      name: p.name,
      type: p.type,
      billingPeriod: p.billingPeriod,
      billingUnit: p.billingUnit,
      sort,
    }
    let planId = p.id && keep.includes(p.id) ? p.id : null
    if (planId) await tx.update(schema.plans).set(values).where(eq(schema.plans.id, planId))
    else planId = (await tx.insert(schema.plans).values(values).returning({ id: schema.plans.id }))[0]!.id
    await tx.delete(schema.prices).where(eq(schema.prices.planId, planId))
    if (p.type !== 'free' && p.prices.length) {
      await tx.insert(schema.prices).values(
        p.prices.map((x) => ({
          planId: planId!,
          currencyCode: x.currency.toUpperCase(),
          price: x.price,
          setupFee: x.setupFee,
        })),
      )
    }
  }
}

async function plansWithPrices(type: 'product' | 'config_option', ids: number[]) {
  if (!ids.length) return []
  const plans = await db.query.plans.findMany({
    where: and(eq(schema.plans.priceableType, type), inArray(schema.plans.priceableId, ids)),
    orderBy: asc(schema.plans.sort),
  })
  const prices = plans.length
    ? await db.query.prices.findMany({
        where: inArray(
          schema.prices.planId,
          plans.map((p) => p.id),
        ),
      })
    : []
  return plans.map((p) => ({
    ...p,
    prices: prices
      .filter((x) => x.planId === p.id)
      .map((x) => ({ currency: x.currencyCode, price: x.price, setupFee: x.setupFee })),
  }))
}

const categoryBody = z.object({
  name: z.string().min(1).max(191),
  slug,
  description: z.string().nullish(),
  image: z.string().nullish(),
  parentId: z.number().int().nullish(),
  sort: z.number().int().default(0),
  hidden: z.boolean().default(false),
})

const productBody = z.object({
  categoryId: z.number().int(),
  name: z.string().min(1).max(191),
  slug,
  description: z.string().nullish(),
  image: z.string().nullish(),
  stock: z.number().int().min(0).nullish(),
  perUserLimit: z.number().int().min(1).nullish(),
  allowQuantity: z.enum(['disabled', 'separated', 'combined']).default('disabled'),
  hidden: z.boolean().default(false),
  sort: z.number().int().default(0),
  serverExtension: z.string().nullish(),
  serverSettings: z.record(z.string(), z.unknown()).default({}),
  plans: z.array(planBody).min(1, 'Add at least one plan'),
  upgradeIds: z.array(z.number().int()).default([]),
})

const optionValue = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(191),
  envVariable: z.string().max(191).nullish(),
  hidden: z.boolean().default(false),
  plans: z.array(planBody).default([]),
})
const configOptionBody = z.object({
  name: z.string().min(1).max(191),
  envVariable: z.string().max(191).nullish(),
  type: z.enum(['select', 'radio', 'slider', 'number', 'text', 'checkbox']),
  sort: z.number().int().default(0),
  hidden: z.boolean().default(false),
  upgradable: z.boolean().default(false),
  productIds: z.array(z.number().int()).default([]),
  plans: z.array(planBody).default([]),
  values: z.array(optionValue).default([]),
})

const couponBody = z.object({
  code: z.string().min(1).max(64).regex(/^\S+$/, 'No spaces allowed'),
  type: z.enum(['percentage', 'fixed', 'free_setup']),
  value: money.default('0.00'),
  recurring: z.number().int().min(1).nullish(),
  maxUses: z.number().int().min(1).nullish(),
  maxUsesPerUser: z.number().int().min(1).nullish(),
  productIds: z.array(z.number().int()).default([]),
  startsAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
})

export const adminBillingRoutes = new Hono<AppEnv>()
  // ── Categories ───────────────────────────────────────────
  .get('/categories', requirePermission('admin.products.manage'), async (c) => {
    const rows = await db
      .select({ category: schema.categories, products: count(schema.products.id) })
      .from(schema.categories)
      .leftJoin(schema.products, eq(schema.products.categoryId, schema.categories.id))
      .groupBy(schema.categories.id)
      .orderBy(asc(schema.categories.sort), asc(schema.categories.name))
    return c.json({ data: rows.map((r) => ({ ...r.category, productCount: r.products })) })
  })
  .post(
    '/categories',
    requirePermission('admin.products.manage'),
    validate('json', categoryBody),
    async (c) => {
      const [row] = await db.insert(schema.categories).values(c.req.valid('json')).returning()
      return c.json({ data: row }, 201)
    },
  )
  .patch(
    '/categories/:id',
    requirePermission('admin.products.manage'),
    validate('json', categoryBody.partial()),
    async (c) => {
      const [row] = await db
        .update(schema.categories)
        .set(await onlyProvided(c, c.req.valid('json')))
        .where(eq(schema.categories.id, intId(c.req.param('id'))))
        .returning()
      if (!row) throw notFound('Category')
      return c.json({ data: row })
    },
  )
  .delete('/categories/:id', requirePermission('admin.products.manage'), async (c) => {
    const id = intId(c.req.param('id'))
    const [used] = await db
      .select({ n: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, id))
    if (used!.n) throw new HttpError(409, 'Move or delete the products in this category first', 'in_use')
    await db.delete(schema.categories).where(eq(schema.categories.id, id))
    return c.json({ ok: true })
  })

  // ── Products ─────────────────────────────────────────────
  .get('/products', requirePermission('admin.products.manage'), async (c) => {
    const products = await db.query.products.findMany({
      orderBy: [asc(schema.products.categoryId), asc(schema.products.sort), asc(schema.products.id)],
    })
    const plans = await plansWithPrices(
      'product',
      products.map((p) => p.id),
    )
    return c.json({
      data: products.map((p) => ({ ...p, plans: plans.filter((x) => x.priceableId === p.id) })),
    })
  })
  .get('/products/:id', requirePermission('admin.products.manage'), async (c) => {
    const product = await db.query.products.findFirst({
      where: eq(schema.products.id, intId(c.req.param('id'))),
    })
    if (!product) throw notFound('Product')
    const upgrades = await db.query.productUpgrades.findMany({
      where: eq(schema.productUpgrades.productId, product.id),
    })
    return c.json({
      data: {
        ...product,
        plans: await plansWithPrices('product', [product.id]),
        upgradeIds: upgrades.map((u) => u.upgradeId),
      },
    })
  })
  .post('/products', requirePermission('admin.products.manage'), validate('json', productBody), async (c) => {
    const { plans, upgradeIds, ...values } = c.req.valid('json')
    const product = await db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.products).values(values).returning()
      await syncPlans(tx, 'product', row!.id, plans)
      if (upgradeIds.length)
        await tx
          .insert(schema.productUpgrades)
          .values(upgradeIds.map((u) => ({ productId: row!.id, upgradeId: u })))
      return row!
    })
    await logActivity({
      event: 'admin:product.create',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      subject: { type: 'product', id: product.id },
    })
    return c.json({ data: product }, 201)
  })
  .put(
    '/products/:id',
    requirePermission('admin.products.manage'),
    validate('json', productBody),
    async (c) => {
      const id = intId(c.req.param('id'))
      const { plans, upgradeIds, ...values } = c.req.valid('json')
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.products)
          .set(values)
          .where(eq(schema.products.id, id))
          .returning()
        if (!row) throw notFound('Product')
        await syncPlans(tx, 'product', id, plans)
        await tx.delete(schema.productUpgrades).where(eq(schema.productUpgrades.productId, id))
        if (upgradeIds.length)
          await tx
            .insert(schema.productUpgrades)
            .values(upgradeIds.map((u) => ({ productId: id, upgradeId: u })))
      })
      return c.json({ ok: true })
    },
  )
  .delete('/products/:id', requirePermission('admin.products.manage'), async (c) => {
    const id = intId(c.req.param('id'))
    const [used] = await db
      .select({ n: count() })
      .from(schema.services)
      .where(eq(schema.services.productId, id))
    if (used!.n)
      throw new HttpError(409, 'This product has services. Hide it instead of deleting it.', 'in_use')
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.plans)
        .where(and(eq(schema.plans.priceableType, 'product'), eq(schema.plans.priceableId, id)))
      await tx.delete(schema.products).where(eq(schema.products.id, id))
    })
    return c.json({ ok: true })
  })
  // Fields of the product's provisioner extension (e.g. egg, memory).
  .get('/provisioners', requirePermission('admin.products.manage'), async (c) => {
    const list = listExtensions().filter((e) => e.enabled && e.module.provisioner)
    const data = await Promise.all(
      list.map(async (e) => ({
        id: e.manifest.id,
        name: e.manifest.name,
        fields: (await getProvisioner(e.manifest.id)!.provisioner.productSettings?.()) ?? [],
      })),
    )
    return c.json({ data })
  })

  // ── Config options ───────────────────────────────────────
  .get('/config-options', requirePermission('admin.products.manage'), async (c) => {
    const all = await db.query.configOptions.findMany({
      orderBy: [asc(schema.configOptions.sort), asc(schema.configOptions.id)],
    })
    const links = await db.query.configOptionProducts.findMany()
    const plans = await plansWithPrices(
      'config_option',
      all.map((o) => o.id),
    )
    const withPlans = (id: number) => plans.filter((p) => p.priceableId === id)
    return c.json({
      data: all
        .filter((o) => o.parentId === null)
        .map((o) => ({
          ...o,
          plans: withPlans(o.id),
          productIds: links.filter((l) => l.configOptionId === o.id).map((l) => l.productId),
          values: all.filter((v) => v.parentId === o.id).map((v) => ({ ...v, plans: withPlans(v.id) })),
        })),
    })
  })
  .post(
    '/config-options',
    requirePermission('admin.products.manage'),
    validate('json', configOptionBody),
    async (c) => {
      const id = await db.transaction(async (tx) => saveConfigOption(tx, null, c.req.valid('json')))
      return c.json({ data: { id } }, 201)
    },
  )
  .put(
    '/config-options/:id',
    requirePermission('admin.products.manage'),
    validate('json', configOptionBody),
    async (c) => {
      const id = intId(c.req.param('id'))
      await db.transaction(async (tx) => saveConfigOption(tx, id, c.req.valid('json')))
      return c.json({ ok: true })
    },
  )
  .delete('/config-options/:id', requirePermission('admin.products.manage'), async (c) => {
    const id = intId(c.req.param('id'))
    await db.transaction(async (tx) => {
      const children = await tx.query.configOptions.findMany({ where: eq(schema.configOptions.parentId, id) })
      const ids = [id, ...children.map((x) => x.id)]
      await tx
        .delete(schema.plans)
        .where(and(eq(schema.plans.priceableType, 'config_option'), inArray(schema.plans.priceableId, ids)))
      await tx.delete(schema.configOptions).where(inArray(schema.configOptions.id, ids))
    })
    return c.json({ ok: true })
  })

  // ── Coupons ──────────────────────────────────────────────
  .get('/coupons', requirePermission('admin.coupons.manage'), async (c) => {
    const rows = await db
      .select({ coupon: schema.coupons, uses: count(schema.services.id) })
      .from(schema.coupons)
      .leftJoin(schema.services, eq(schema.services.couponId, schema.coupons.id))
      .groupBy(schema.coupons.id)
      .orderBy(desc(schema.coupons.id))
    return c.json({ data: rows.map((r) => ({ ...r.coupon, uses: r.uses })) })
  })
  .post('/coupons', requirePermission('admin.coupons.manage'), validate('json', couponBody), async (c) => {
    const [row] = await db.insert(schema.coupons).values(c.req.valid('json')).returning()
    return c.json({ data: row }, 201)
  })
  .put('/coupons/:id', requirePermission('admin.coupons.manage'), validate('json', couponBody), async (c) => {
    const [row] = await db
      .update(schema.coupons)
      .set(c.req.valid('json'))
      .where(eq(schema.coupons.id, intId(c.req.param('id'))))
      .returning()
    if (!row) throw notFound('Coupon')
    return c.json({ data: row })
  })
  .delete('/coupons/:id', requirePermission('admin.coupons.manage'), async (c) => {
    await db.delete(schema.coupons).where(eq(schema.coupons.id, intId(c.req.param('id'))))
    return c.json({ ok: true })
  })

  // ── Currencies & taxes ───────────────────────────────────
  .get('/currencies', requirePermission('admin.taxes.manage'), async (c) =>
    c.json({ data: await db.query.currencies.findMany() }),
  )
  .put(
    '/currencies/:code',
    requirePermission('admin.taxes.manage'),
    validate(
      'json',
      z.object({
        prefix: z.string().max(8).default(''),
        suffix: z.string().max(8).default(''),
        rate: z.coerce.number().positive().default(1),
        isDefault: z.boolean().default(false),
      }),
    ),
    async (c) => {
      const code = c.req.param('code').toUpperCase()
      if (!/^[A-Z]{3}$/.test(code)) throw new HttpError(422, 'Currency code must be 3 letters', 'invalid')
      const v = c.req.valid('json')
      await db.transaction(async (tx) => {
        if (v.isDefault) await tx.update(schema.currencies).set({ isDefault: false })
        await tx
          .insert(schema.currencies)
          .values({ code, prefix: v.prefix, suffix: v.suffix, rate: String(v.rate), isDefault: v.isDefault })
          .onConflictDoUpdate({
            target: schema.currencies.code,
            set: { prefix: v.prefix, suffix: v.suffix, rate: String(v.rate), isDefault: v.isDefault },
          })
      })
      return c.json({ ok: true })
    },
  )
  .get('/tax-rates', requirePermission('admin.taxes.manage'), async (c) =>
    c.json({ data: await db.query.taxRates.findMany() }),
  )
  .post(
    '/tax-rates',
    requirePermission('admin.taxes.manage'),
    validate(
      'json',
      z.object({
        name: z.string().min(1).max(64),
        rate: z.coerce.number().min(0).max(100),
        country: z.string().length(2).nullish(),
        state: z.string().max(64).nullish(),
      }),
    ),
    async (c) => {
      const v = c.req.valid('json')
      const [row] = await db
        .insert(schema.taxRates)
        .values({ ...v, rate: String(v.rate), country: v.country?.toUpperCase() ?? null })
        .returning()
      return c.json({ data: row }, 201)
    },
  )
  .delete('/tax-rates/:id', requirePermission('admin.taxes.manage'), async (c) => {
    await db.delete(schema.taxRates).where(eq(schema.taxRates.id, intId(c.req.param('id'))))
    return c.json({ ok: true })
  })

  // ── Extensions ───────────────────────────────────────────
  .get('/extensions', requirePermission('admin.extensions.manage'), (c) =>
    c.json({
      data: listExtensions().map((e) => ({
        ...e.manifest,
        builtin: e.builtin,
        enabled: e.enabled,
        error: e.error ?? null,
        settingsSchema: e.module.settings ?? [],
        // Never send secrets back; the form shows them as "unchanged".
        settings: Object.fromEntries(
          (e.module.settings ?? []).map((f) => [
            f.key,
            f.type === 'password' ? (e.settings[f.key] ? '••••••••' : '') : e.settings[f.key],
          ]),
        ),
      })),
    }),
  )
  .put(
    '/extensions/:id',
    requirePermission('admin.extensions.manage'),
    validate(
      'json',
      z.object({ enabled: z.boolean().optional(), settings: z.record(z.string(), z.unknown()).optional() }),
    ),
    async (c) => {
      const id = c.req.param('id')
      if (!getExtension(id)) throw notFound('Extension')
      const body = c.req.valid('json')
      // The masked placeholder means "keep the current secret".
      if (body.settings)
        for (const [k, v] of Object.entries(body.settings)) if (v === '••••••••') body.settings[k] = ''
      await saveExtension(id, body)
      await logActivity({
        event: 'admin:extension.update',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        properties: { id, enabled: body.enabled },
      })
      return c.json({ ok: true })
    },
  )

  // ── Services ─────────────────────────────────────────────
  .get('/services', requirePermission('admin.orders.view'), async (c) => {
    const q = c.req.query('q')
    const status = c.req.query('status')
    const rows = await db
      .select({
        service: schema.services,
        product: schema.products.name,
        user: { id: schema.users.id, email: schema.users.email, username: schema.users.username },
      })
      .from(schema.services)
      .innerJoin(schema.products, eq(schema.products.id, schema.services.productId))
      .innerJoin(schema.users, eq(schema.users.id, schema.services.userId))
      .where(
        and(
          status ? eq(schema.services.status, status) : undefined,
          q ? or(ilike(schema.users.email, `%${q}%`), ilike(schema.products.name, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(schema.services.id))
      .limit(200)
    return c.json({ data: rows.map((r) => ({ ...r.service, product: r.product, user: r.user })) })
  })
  .post(
    '/services/:id/action',
    requirePermission('admin.services.manage'),
    validate('json', z.object({ action: z.enum(['activate', 'suspend', 'unsuspend', 'terminate']) })),
    async (c) => {
      const id = intId(c.req.param('id'))
      const { action } = c.req.valid('json')
      try {
        if (action === 'activate') await activateOrRenew(id)
        if (action === 'suspend') await suspendService(id, 'admin')
        if (action === 'unsuspend') await unsuspendService(id)
        if (action === 'terminate') await terminateService(id, 'admin')
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw new HttpError(502, `The provisioner failed: ${(e as Error).message}`, 'provisioner_error')
      }
      await logActivity({
        event: `admin:service.${action}`,
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'service', id },
      })
      return c.json({ ok: true })
    },
  )

  // ── Invoices ─────────────────────────────────────────────
  .get('/invoices', requirePermission('admin.invoices.view'), async (c) => {
    const status = c.req.query('status')
    const rows = await db
      .select({ invoice: schema.invoices, user: { id: schema.users.id, email: schema.users.email } })
      .from(schema.invoices)
      .innerJoin(schema.users, eq(schema.users.id, schema.invoices.userId))
      .where(status ? eq(schema.invoices.status, status) : undefined)
      .orderBy(desc(schema.invoices.id))
      .limit(200)
    const ids = rows.map((r) => r.invoice.id)
    const items = ids.length
      ? await db.query.invoiceItems.findMany({ where: inArray(schema.invoiceItems.invoiceId, ids) })
      : []
    return c.json({
      data: rows.map((r) => ({
        ...r.invoice,
        user: r.user,
        total: fromCents(
          items
            .filter((i) => i.invoiceId === r.invoice.id)
            .reduce((s, i) => s + toCents(i.price) * i.quantity, 0),
        ),
      })),
    })
  })
  .get('/invoices/:id', requirePermission('admin.invoices.view'), async (c) => {
    const invoice = await invoiceWithItems(intId(c.req.param('id')))
    if (!invoice) throw notFound('Invoice')
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, invoice.userId) })
    return c.json({
      data: invoice,
      billing: {
        company: await getSettings(['billing.company_details']).then((s) =>
          String(s['billing.company_details'] ?? ''),
        ),
        companyName: await getSettings(['app.name']).then((s) => String(s['app.name'])),
        customer: user
          ? {
              id: user.id,
              name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
              email: user.email,
              country: (user.properties.country as string) ?? null,
            }
          : null,
      },
    })
  })
  .post(
    '/invoices/:id/payment',
    requirePermission('admin.invoices.manage'),
    validate(
      'json',
      z.object({
        amount: money,
        gateway: z.string().max(64).default('manual'),
        transactionId: z.string().max(191).nullish(),
      }),
    ),
    async (c) => {
      const id = intId(c.req.param('id'))
      const v = c.req.valid('json')
      await markInvoicePaid(id, {
        gateway: v.gateway,
        transactionId: v.transactionId ?? `manual-${Date.now()}`,
        amount: v.amount,
      })
      await logActivity({
        event: 'admin:invoice.payment',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'invoice', id },
        properties: v,
      })
      return c.json({ ok: true })
    },
  )
  .post(
    '/invoices/:id/transactions/:transaction/refund',
    requirePermission('admin.invoices.manage'),
    validate('json', z.object({ amount: money, method: z.enum(['gateway', 'credit', 'manual']) })),
    async (c) => {
      const { amount, method } = c.req.valid('json')
      const tx = await db.query.invoiceTransactions.findFirst({
        where: eq(schema.invoiceTransactions.id, intId(c.req.param('transaction'))),
      })
      if (!tx || tx.invoiceId !== intId(c.req.param('id'))) throw notFound('Payment')
      await refundTransaction(tx.id, amount, method, c.get('user')!.id)
      return c.json({ ok: true })
    },
  )
  // Manual invoice for a customer (custom work, one-off fees...).
  .post(
    '/invoices',
    requirePermission('admin.invoices.manage'),
    validate(
      'json',
      z.object({
        userId: z.number().int(),
        currency: z.string().length(3).optional(),
        dueAt: z.coerce.date().optional(),
        items: z
          .array(
            z.object({
              description: z.string().min(1).max(2000),
              price: money,
              quantity: z.number().int().min(1).max(1000).default(1),
            }),
          )
          .min(1)
          .max(50),
        notify: z.boolean().default(true),
      }),
    ),
    async (c) => {
      const v = c.req.valid('json')
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, v.userId) })
      if (!user) throw notFound('User')
      const { getCurrency } = await import('../../../services/billing/pricing')
      const { currency } = await getCurrency(v.currency)
      const invoice = await createInvoice({
        userId: user.id,
        currency: currency.code,
        dueAt: v.dueAt ?? new Date(Date.now() + 7 * 86_400_000),
        items: v.items.map((i) => ({
          description: i.description,
          price: toCents(i.price),
          quantity: i.quantity,
          referenceType: 'custom' as const,
        })),
      })
      if (v.notify) {
        const { invoiceCreated } = await import('../../../services/notify')
        await invoiceCreated(invoice.id)
      }
      await logActivity({
        event: 'admin:invoice.create',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'invoice', id: invoice.id },
      })
      return c.json({ data: { id: invoice.id } }, 201)
    },
  )
  .post('/invoices/:id/cancel', requirePermission('admin.invoices.manage'), async (c) => {
    await db
      .update(schema.invoices)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.invoices.id, intId(c.req.param('id'))), eq(schema.invoices.status, 'pending')))
    return c.json({ ok: true })
  })

  // ── Settings ─────────────────────────────────────────────
  .get('/settings', requirePermission('admin.settings.manage'), async (c) =>
    c.json({ data: await getSettings() }),
  )
  .put(
    '/settings',
    requirePermission('admin.settings.manage'),
    validate('json', z.record(z.string(), z.unknown())),
    async (c) => {
      const values = c.req.valid('json')
      const unknown = Object.keys(values).filter((k) => !(k in defaultSettings) && !k.startsWith('ext.'))
      if (unknown.length) throw new HttpError(422, `Unknown settings: ${unknown.join(', ')}`, 'invalid')
      for (const [k, v] of Object.entries(values)) {
        const def = (defaultSettings as Record<string, unknown>)[k]
        if (def !== null && def !== undefined && v !== null && typeof v !== typeof def)
          throw new HttpError(422, `${k} must be a ${typeof def}`, 'invalid')
      }
      await setSettings(values)
      return c.json({ ok: true })
    },
  )

async function saveConfigOption(tx: Tx, id: number | null, body: z.infer<typeof configOptionBody>) {
  const { values, plans, productIds, ...fields } = body
  let optionId = id
  if (optionId) {
    const [row] = await tx
      .update(schema.configOptions)
      .set(fields)
      .where(and(eq(schema.configOptions.id, optionId), isNull(schema.configOptions.parentId)))
      .returning()
    if (!row) throw notFound('Config option')
  } else {
    optionId = (
      await tx.insert(schema.configOptions).values(fields).returning({ id: schema.configOptions.id })
    )[0]!.id
  }
  await syncPlans(tx, 'config_option', optionId, fields.type === 'checkbox' ? plans : [])

  const keep = values.filter((v) => v.id).map((v) => v.id!)
  const stale = await tx.query.configOptions.findMany({
    where: and(
      eq(schema.configOptions.parentId, optionId),
      keep.length ? notInArray(schema.configOptions.id, keep) : undefined,
    ),
  })
  if (stale.length) {
    await tx.delete(schema.plans).where(
      and(
        eq(schema.plans.priceableType, 'config_option'),
        inArray(
          schema.plans.priceableId,
          stale.map((s) => s.id),
        ),
      ),
    )
    await tx.delete(schema.configOptions).where(
      inArray(
        schema.configOptions.id,
        stale.map((s) => s.id),
      ),
    )
  }
  const choice = fields.type === 'select' || fields.type === 'radio'
  for (const [sort, v] of (choice ? values : []).entries()) {
    const data = {
      parentId: optionId,
      name: v.name,
      envVariable: v.envVariable ?? null,
      hidden: v.hidden,
      sort,
      type: fields.type,
    }
    let valueId = v.id && keep.includes(v.id) ? v.id : null
    if (valueId)
      await tx
        .update(schema.configOptions)
        .set(data)
        .where(and(eq(schema.configOptions.id, valueId), eq(schema.configOptions.parentId, optionId)))
    else
      valueId = (
        await tx.insert(schema.configOptions).values(data).returning({ id: schema.configOptions.id })
      )[0]!.id
    await syncPlans(tx, 'config_option', valueId, v.plans)
  }
  await tx.delete(schema.configOptionProducts).where(eq(schema.configOptionProducts.configOptionId, optionId))
  if (productIds.length)
    await tx
      .insert(schema.configOptionProducts)
      .values(productIds.map((p) => ({ configOptionId: optionId!, productId: p })))
  return optionId
}
