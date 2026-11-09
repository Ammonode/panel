import { and, asc, count, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { db, schema } from '../../db'
import { HttpError } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { describePeriod, fromCents, percentOf, toCents } from './money'

type Plan = typeof schema.plans.$inferSelect

export type PlanPrice = {
  id: number
  name: string
  type: string
  billingPeriod: number
  billingUnit: string
  label: string
  price: number // cents
  setupFee: number // cents
}

export async function getCurrency(code?: string | null) {
  const all = await db.query.currencies.findMany()
  const def = all.find((c) => c.isDefault) ?? all[0]
  if (!def) throw new HttpError(500, 'No currency configured', 'server_error')
  return { currency: all.find((c) => c.code === code) ?? def, default: def }
}

/** Resolves the price of plans in a currency, converting from the default currency when not set. */
export async function pricePlans(plans: Plan[], currencyCode: string): Promise<PlanPrice[]> {
  if (!plans.length) return []
  const { currency, default: def } = await getCurrency(currencyCode)
  const prices = await db.query.prices.findMany({
    where: inArray(
      schema.prices.planId,
      plans.map((p) => p.id),
    ),
  })
  return plans.map((plan) => {
    const own = prices.find((p) => p.planId === plan.id && p.currencyCode === currency.code)
    const base = prices.find((p) => p.planId === plan.id && p.currencyCode === def.code)
    const rate = Number(currency.rate)
    const price = own ? toCents(own.price) : Math.round(toCents(base?.price) * rate)
    const setupFee = own ? toCents(own.setupFee) : Math.round(toCents(base?.setupFee) * rate)
    return {
      id: plan.id,
      name: plan.name,
      type: plan.type,
      billingPeriod: plan.billingPeriod,
      billingUnit: plan.billingUnit,
      label:
        plan.type === 'free'
          ? 'Free'
          : plan.type === 'one-time'
            ? 'One time'
            : describePeriod(plan.billingPeriod, plan.billingUnit),
      price: plan.type === 'free' ? 0 : price,
      setupFee: plan.type === 'free' ? 0 : setupFee,
    }
  })
}

const plansOf = (type: 'product' | 'config_option', ids: number[]) =>
  ids.length
    ? db.query.plans.findMany({
        where: and(eq(schema.plans.priceableType, type), inArray(schema.plans.priceableId, ids)),
        orderBy: [asc(schema.plans.sort), asc(schema.plans.id)],
      })
    : Promise.resolve([])

/** Full product description for the store and checkout. */
export async function getProductForSale(productId: number, currencyCode: string) {
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) })
  if (!product) throw new HttpError(404, 'Product not found', 'not_found')
  const plans = await pricePlans(await plansOf('product', [product.id]), currencyCode)

  const links = await db.query.configOptionProducts.findMany({
    where: eq(schema.configOptionProducts.productId, product.id),
  })
  const parentIds = links.map((l) => l.configOptionId)
  const parents = parentIds.length
    ? await db.query.configOptions.findMany({
        where: and(inArray(schema.configOptions.id, parentIds), isNull(schema.configOptions.parentId)),
        orderBy: asc(schema.configOptions.sort),
      })
    : []
  const children = parents.length
    ? await db.query.configOptions.findMany({
        where: inArray(
          schema.configOptions.parentId,
          parents.map((p) => p.id),
        ),
        orderBy: asc(schema.configOptions.sort),
      })
    : []
  const priceable = [...parents.filter((p) => p.type === 'checkbox'), ...children]
  const optionPlans = await plansOf(
    'config_option',
    priceable.map((c) => c.id),
  )
  const optionPrices = await pricePlans(optionPlans, currencyCode)
  const priced = (optionId: number) =>
    optionPlans.filter((p) => p.priceableId === optionId).map((p) => optionPrices.find((x) => x.id === p.id)!)

  const configOptions = parents
    .filter((p) => !p.hidden)
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      envVariable: p.envVariable,
      upgradable: p.upgradable,
      plans: p.type === 'checkbox' ? priced(p.id) : [],
      values: children
        .filter((c) => c.parentId === p.id && !c.hidden)
        .map((c) => ({ id: c.id, name: c.name, envVariable: c.envVariable, plans: priced(c.id) })),
    }))

  return { product, plans, configOptions }
}

/** Price of a config option selection for the billing cycle of the chosen product plan. */
function matchPlan(plans: PlanPrice[], plan: PlanPrice) {
  if (plan.type !== 'recurring') return plans.find((p) => p.type === plan.type) ?? plans[0]
  return plans.find((p) => p.billingPeriod === plan.billingPeriod && p.billingUnit === plan.billingUnit)
}

export type CartItemInput = {
  productId: number
  planId: number
  quantity?: number
  configOptions?: Record<string, string | number | boolean>
  checkoutConfig?: Record<string, string>
}

export type PricedLine = {
  product: typeof schema.products.$inferSelect
  plan: PlanPrice
  quantity: number
  configs: {
    optionId: number
    valueId: number | null
    value: string | null
    label: string
    envVariable: string | null
    price: number
    setupFee: number
  }[]
  description: string
  /** Recurring amount per cycle (cents, per unit, before coupon). */
  price: number
  setupFee: number
  discount: number
  /** Recurring amount after a coupon that keeps applying. */
  renewalPrice: number
  checkoutConfig: Record<string, string>
}

type Coupon = typeof schema.coupons.$inferSelect

export async function findCoupon(code: string, userId: number | null) {
  const coupon = await db.query.coupons.findFirst({ where: eq(schema.coupons.code, code.trim()) })
  if (!coupon)
    throw new HttpError(422, 'This coupon code is invalid', 'invalid_coupon', {
      coupon: 'This coupon code is invalid',
    })
  const now = new Date()
  if ((coupon.startsAt && coupon.startsAt > now) || (coupon.expiresAt && coupon.expiresAt < now)) {
    throw new HttpError(422, 'This coupon has expired', 'invalid_coupon', {
      coupon: 'This coupon has expired',
    })
  }
  if (coupon.maxUses != null || coupon.maxUsesPerUser != null) {
    const [total] = await db
      .select({ n: count() })
      .from(schema.services)
      .where(and(eq(schema.services.couponId, coupon.id), ne(schema.services.status, 'cancelled')))
    if (coupon.maxUses != null && total!.n >= coupon.maxUses) {
      throw new HttpError(422, 'This coupon has reached its usage limit', 'invalid_coupon', {
        coupon: 'This coupon has reached its usage limit',
      })
    }
    if (coupon.maxUsesPerUser != null && userId) {
      const [mine] = await db
        .select({ n: count() })
        .from(schema.services)
        .where(and(eq(schema.services.couponId, coupon.id), eq(schema.services.userId, userId)))
      if (mine!.n >= coupon.maxUsesPerUser) {
        throw new HttpError(422, 'You have already used this coupon', 'invalid_coupon', {
          coupon: 'You have already used this coupon',
        })
      }
    }
  }
  return coupon
}

/** Discount (cents, per unit) a coupon gives on a price + setup fee. */
export function couponDiscount(coupon: Coupon, price: number, setupFee: number, firstPayment: boolean) {
  const value = Number(coupon.value)
  switch (coupon.type) {
    case 'percentage':
      return percentOf(price, value) + (firstPayment ? percentOf(setupFee, value) : 0)
    case 'fixed':
      return Math.min(price + (firstPayment ? setupFee : 0), toCents(value))
    case 'free_setup':
      return firstPayment ? setupFee : 0
    default:
      return 0
  }
}

/** Validates cart items and calculates every amount server side. */
export async function priceCart(
  items: CartItemInput[],
  opts: { currency: string; couponCode?: string | null; userId: number | null },
) {
  if (!items.length) throw new HttpError(422, 'Your cart is empty', 'invalid')
  const coupon = opts.couponCode ? await findCoupon(opts.couponCode, opts.userId) : null
  let couponUsed = false
  const lines: PricedLine[] = []

  for (const item of items) {
    const { product, plans, configOptions } = await getProductForSale(item.productId, opts.currency)
    if (product.hidden && !opts.userId)
      throw new HttpError(422, `${product.name} is not available`, 'invalid')
    const plan = plans.find((p) => p.id === item.planId)
    if (!plan) throw new HttpError(422, `Choose a billing cycle for ${product.name}`, 'invalid')
    const quantity =
      product.allowQuantity === 'disabled' ? 1 : Math.max(1, Math.min(100, Math.floor(item.quantity ?? 1)))
    if (product.stock !== null && product.stock < quantity)
      throw new HttpError(422, `${product.name} is out of stock`, 'out_of_stock')
    if (product.perUserLimit && opts.userId) {
      const [owned] = await db
        .select({ n: count() })
        .from(schema.services)
        .where(
          and(
            eq(schema.services.userId, opts.userId),
            eq(schema.services.productId, product.id),
            or(
              eq(schema.services.status, 'active'),
              eq(schema.services.status, 'pending'),
              eq(schema.services.status, 'suspended'),
            ),
          ),
        )
      if (owned!.n + quantity > product.perUserLimit)
        throw new HttpError(422, `You can only order ${product.perUserLimit} of ${product.name}`, 'limit')
    }

    const configs: PricedLine['configs'] = []
    for (const option of configOptions) {
      const raw = item.configOptions?.[option.id]
      if (option.type === 'select' || option.type === 'radio') {
        const value = option.values.find((v) => String(v.id) === String(raw)) ?? option.values[0]
        if (!value) continue
        const p = matchPlan(value.plans, plan)
        configs.push({
          optionId: option.id,
          valueId: value.id,
          value: null,
          label: `${option.name}: ${value.name}`,
          envVariable: value.envVariable ?? option.envVariable,
          price: p?.price ?? 0,
          setupFee: p?.setupFee ?? 0,
        })
      } else if (option.type === 'checkbox') {
        const on = raw === true || raw === 'true' || raw === '1' || raw === 1
        const p = on ? matchPlan(option.plans, plan) : undefined
        configs.push({
          optionId: option.id,
          valueId: null,
          value: on ? '1' : '0',
          label: `${option.name}: ${on ? 'Yes' : 'No'}`,
          envVariable: option.envVariable,
          price: p?.price ?? 0,
          setupFee: p?.setupFee ?? 0,
        })
      } else {
        const value = raw == null ? '' : String(raw).slice(0, 1000)
        if (option.type === 'number' || option.type === 'slider') {
          if (value !== '' && Number.isNaN(Number(value)))
            throw new HttpError(422, `${option.name} must be a number`, 'invalid')
        }
        configs.push({
          optionId: option.id,
          valueId: null,
          value,
          label: `${option.name}: ${value || '—'}`,
          envVariable: option.envVariable,
          price: 0,
          setupFee: 0,
        })
      }
    }

    const price = plan.price + configs.reduce((s, c) => s + c.price, 0)
    const setupFee = plan.setupFee + configs.reduce((s, c) => s + c.setupFee, 0)
    let discount = 0
    let renewalPrice = price
    if (coupon && (!coupon.productIds.length || coupon.productIds.includes(product.id))) {
      discount = couponDiscount(coupon, price, setupFee, true)
      // `recurring` = number of cycles the coupon applies to; null = forever.
      if (coupon.recurring === null || coupon.recurring > 1)
        renewalPrice = price - couponDiscount(coupon, price, setupFee, false)
      couponUsed = couponUsed || discount > 0
    }
    lines.push({
      product,
      plan,
      quantity,
      configs,
      description: `${product.name} (${plan.label})`,
      price,
      setupFee,
      discount,
      renewalPrice,
      checkoutConfig: item.checkoutConfig ?? {},
    })
  }
  if (coupon && !couponUsed)
    throw new HttpError(422, 'This coupon does not apply to the products in your cart', 'invalid_coupon', {
      coupon: 'This coupon does not apply to your cart',
    })

  const subtotal = lines.reduce((s, l) => s + (l.price + l.setupFee) * l.quantity, 0)
  const discount = lines.reduce((s, l) => s + l.discount * l.quantity, 0)
  const tax = await calculateTax(subtotal - discount, opts.userId)
  return {
    lines,
    coupon,
    currency: opts.currency,
    subtotal,
    discount,
    tax: tax.amount,
    taxRate: tax.rate,
    taxName: tax.name,
    total: subtotal - discount + (tax.inclusive ? 0 : tax.amount),
  }
}

/** Looks up the tax rate for a user's country (stored in `users.properties.country`). */
export async function calculateTax(amount: number, userId: number | null) {
  const none = { amount: 0, rate: 0, name: null as string | null, inclusive: false }
  if (!(await getSetting('billing.tax_enabled')) || amount <= 0) return none
  const user = userId ? await db.query.users.findFirst({ where: eq(schema.users.id, userId) }) : null
  const country = typeof user?.properties.country === 'string' ? user.properties.country.toUpperCase() : null
  const rates = await db.query.taxRates.findMany()
  const rate = rates.find((r) => r.country === country) ?? rates.find((r) => r.country === null)
  if (!rate) return none
  const percent = Number(rate.rate)
  const inclusive = (await getSetting('billing.tax_type')) === 'inclusive'
  const tax = inclusive ? Math.round(amount - amount / (1 + percent / 100)) : percentOf(amount, percent)
  return { amount: tax, rate: percent, name: rate.name, inclusive }
}

export const serializeCart = (cart: Awaited<ReturnType<typeof priceCart>>) => ({
  currency: cart.currency,
  coupon: cart.coupon ? { code: cart.coupon.code, type: cart.coupon.type, value: cart.coupon.value } : null,
  subtotal: fromCents(cart.subtotal),
  discount: fromCents(cart.discount),
  tax: fromCents(cart.tax),
  taxRate: cart.taxRate,
  taxName: cart.taxName,
  total: fromCents(cart.total),
  lines: cart.lines.map((l) => ({
    productId: l.product.id,
    planId: l.plan.id,
    name: l.product.name,
    plan: l.plan.label,
    quantity: l.quantity,
    configs: l.configs.map((c) => c.label),
    price: fromCents(l.price),
    setupFee: fromCents(l.setupFee),
    discount: fromCents(l.discount),
    total: fromCents((l.price + l.setupFee - l.discount) * l.quantity),
  })),
})
