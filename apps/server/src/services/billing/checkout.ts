import { db, schema } from '../../db'
import { emit } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { invoiceCreated } from '../notify'
import { createInvoice, markInvoicePaid, type NewInvoiceItem } from './invoices'
import { fromCents } from './money'
import { type CartItemInput, priceCart } from './pricing'

/**
 * Creates the order, its pending services and the first invoice. Free orders
 * are activated straight away.
 */
export async function checkout(
  userId: number,
  input: { items: CartItemInput[]; couponCode?: string | null; currency: string },
) {
  const cart = await priceCart(input.items, {
    currency: input.currency,
    couponCode: input.couponCode,
    userId,
  })

  const invoice = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(schema.orders)
      .values({ userId, currencyCode: cart.currency, couponId: cart.coupon?.id ?? null })
      .returning()
    const items: NewInvoiceItem[] = []
    for (const line of cart.lines) {
      for (let n = 0; n < line.quantity; n++) {
        const cycles = cart.coupon?.recurring
        const [service] = await tx
          .insert(schema.services)
          .values({
            userId,
            orderId: order!.id,
            productId: line.product.id,
            planId: line.plan.id,
            couponId: line.discount > 0 ? (cart.coupon?.id ?? null) : null,
            status: 'pending',
            quantity: 1,
            price: fromCents(line.renewalPrice),
            currencyCode: cart.currency,
            properties: {
              checkout: line.checkoutConfig,
              fullPrice: fromCents(line.price),
              // Remaining discounted renewals; null = forever.
              couponCyclesLeft: line.discount > 0 && cycles != null ? Math.max(0, cycles - 1) : null,
            },
          })
          .returning()
        if (line.configs.length) {
          await tx.insert(schema.serviceConfigs).values(
            line.configs.map((c) => ({
              serviceId: service!.id,
              configOptionId: c.optionId,
              configValueId: c.valueId,
              value: c.value,
            })),
          )
        }
        const details = line.configs.length ? `\n${line.configs.map((c) => c.label).join('\n')}` : ''
        items.push({
          description: `${line.description}${details}`,
          price: line.price,
          referenceType: 'service',
          referenceId: service!.id,
        })
        if (line.setupFee)
          items.push({
            description: `Setup fee: ${line.product.name}`,
            price: line.setupFee,
            referenceType: 'custom',
            referenceId: service!.id,
          })
        if (line.discount)
          items.push({
            description: `Discount (${cart.coupon!.code})`,
            price: -line.discount,
            referenceType: 'discount',
            referenceId: service!.id,
          })
      }
    }
    if (cart.tax && cart.taxName && cart.total > cart.subtotal - cart.discount) {
      items.push({ description: `${cart.taxName} (${cart.taxRate}%)`, price: cart.tax, referenceType: 'tax' })
    }
    return createInvoice({ userId, currency: cart.currency, dueAt: new Date(), items }, tx)
  })

  await logActivity({
    event: 'billing:order.created',
    actorId: userId,
    subject: { type: 'invoice', id: invoice.id },
  })
  await emit('invoice.created', { invoiceId: invoice.id, userId })
  if (cart.total > 0) await invoiceCreated(invoice.id)
  if (cart.total === 0)
    await markInvoicePaid(invoice.id, { gateway: null, transactionId: `free-${invoice.id}`, amount: '0.00' })
  return { invoiceId: invoice.id, total: fromCents(cart.total), free: cart.total === 0 }
}
