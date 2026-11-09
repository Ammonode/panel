import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { enabledGateways, getProvisioner } from '../../extensions/registry'
import { notFound } from '../../lib/errors'
import { fromCents } from '../../services/billing/money'
import {
  getCurrency,
  getProductForSale,
  priceCart,
  pricePlans,
  serializeCart,
} from '../../services/billing/pricing'
import type { AppEnv } from '../types'
import { validate } from '../validate'

const serializePlan = (p: Awaited<ReturnType<typeof pricePlans>>[number]) => ({
  ...p,
  price: fromCents(p.price),
  setupFee: fromCents(p.setupFee),
})

export const cartItem = z.object({
  productId: z.number().int(),
  planId: z.number().int(),
  quantity: z.number().int().min(1).max(100).optional(),
  configOptions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  checkoutConfig: z.record(z.string(), z.string().max(500)).optional(),
})

export const storeRoutes = new Hono<AppEnv>()
  .get('/currencies', async (c) => c.json({ data: await db.query.currencies.findMany() }))
  .get('/gateways', (c) => c.json({ data: enabledGateways() }))
  .get('/categories', async (c) => {
    const rows = await db.query.categories.findMany({
      where: eq(schema.categories.hidden, false),
      orderBy: [asc(schema.categories.sort), asc(schema.categories.name)],
    })
    return c.json({ data: rows })
  })
  .get('/categories/:slug', async (c) => {
    const category = await db.query.categories.findFirst({
      where: and(eq(schema.categories.slug, c.req.param('slug')), eq(schema.categories.hidden, false)),
    })
    if (!category) throw notFound('Category')
    const { currency } = await getCurrency(c.req.query('currency'))
    const products = await db.query.products.findMany({
      where: and(eq(schema.products.categoryId, category.id), eq(schema.products.hidden, false)),
      orderBy: [asc(schema.products.sort), asc(schema.products.id)],
    })
    const plans = products.length
      ? await db.query.plans.findMany({
          where: and(
            eq(schema.plans.priceableType, 'product'),
            inArray(
              schema.plans.priceableId,
              products.map((p) => p.id),
            ),
          ),
          orderBy: asc(schema.plans.sort),
        })
      : []
    const priced = await pricePlans(plans, currency.code)
    return c.json({
      category,
      currency,
      data: products.map((p) => {
        const own = priced.filter((x) => plans.find((pl) => pl.id === x.id)?.priceableId === p.id)
        return {
          ...p,
          serverSettings: undefined,
          plans: own.map(serializePlan),
          inStock: p.stock === null || p.stock > 0,
        }
      }),
    })
  })
  .get('/products/:slug', async (c) => {
    const product = await db.query.products.findFirst({
      where: eq(schema.products.slug, c.req.param('slug')),
    })
    if (!product) throw notFound('Product')
    const { currency } = await getCurrency(c.req.query('currency'))
    const sale = await getProductForSale(product.id, currency.code)
    const p = getProvisioner(product.serverExtension)
    const checkoutFields = p?.provisioner.checkoutFields
      ? await p.provisioner.checkoutFields({ id: product.id, settings: product.serverSettings })
      : []
    return c.json({
      currency,
      data: {
        ...sale.product,
        serverSettings: undefined,
        inStock: product.stock === null || product.stock > 0,
        plans: sale.plans.map(serializePlan),
        configOptions: sale.configOptions.map((o) => ({
          ...o,
          plans: o.plans.map(serializePlan),
          values: o.values.map((v) => ({ ...v, plans: v.plans.map(serializePlan) })),
        })),
        checkoutFields,
      },
    })
  })
  // Price preview for the cart page; checkout recomputes everything.
  .post(
    '/cart',
    validate(
      'json',
      z.object({
        items: z.array(cartItem).max(50),
        couponCode: z.string().max(64).nullish(),
        currency: z.string().length(3).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json')
      const { currency } = await getCurrency(body.currency)
      const cart = await priceCart(body.items, {
        currency: currency.code,
        couponCode: body.couponCode,
        userId: c.get('user')?.id ?? null,
      })
      return c.json({ data: serializeCart(cart) })
    },
  )
