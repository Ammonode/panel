import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ExtensionManifest, ServerExtension } from '@ammonode/sdk'

export const manifest: ExtensionManifest = {
  id: 'stripe',
  name: 'Stripe',
  type: 'gateway',
  version: '1.0.0',
  description: 'Accept cards, Apple Pay, Google Pay and more through Stripe Checkout.',
  author: 'Ammonode',
  ammonode: '*',
}

// Currencies Stripe expects in whole units instead of cents.
const zeroDecimal = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])
const toMinor = (amount: string, currency: string) =>
  zeroDecimal.has(currency.toUpperCase()) ? Math.round(Number(amount)) : Math.round(Number(amount) * 100)
const fromMinor = (amount: number, currency: string) =>
  (zeroDecimal.has(currency.toUpperCase()) ? amount : amount / 100).toFixed(2)

/** Flattens an object to Stripe's form encoding (`a[b][0][c]=x`). */
function encode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k
    if (v === undefined || v === null) continue
    if (typeof v === 'object') encode(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}

async function stripe<T>(
  secret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-06-20',
    },
    body: body ? encode(body) : undefined,
  })
  const data = (await res.json()) as T & { error?: { message: string } }
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.statusText}`)
  return data
}

/** Verifies the `Stripe-Signature` header (v1 scheme, 5 minute tolerance). */
export function verifyStripeSignature(payload: string, header: string, secret: string, now = Date.now()) {
  const parts = Object.fromEntries(
    header
      .split(',')
      .map((p) => p.split('=') as [string, string])
      .filter((p) => p.length === 2),
  )
  const signatures = header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3))
  const t = Number(parts.t)
  if (!t || !signatures.length || Math.abs(now / 1000 - t) > 300) return false
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return signatures.some(
    (s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)),
  )
}

type Session = {
  id: string
  url: string
  payment_status: string
  amount_total: number
  currency: string
  payment_intent: string | null
  metadata: { invoice_id?: string }
}

export const extension: ServerExtension = {
  settings: [
    {
      key: 'secret_key',
      label: 'Secret key',
      type: 'password',
      required: true,
      description: 'sk_live_... or sk_test_... from the Stripe dashboard.',
    },
    {
      key: 'webhook_secret',
      label: 'Webhook signing secret',
      type: 'password',
      required: true,
      description:
        'Add a webhook endpoint for <panel>/api/extensions/stripe/webhook with the event checkout.session.completed.',
    },
    { key: 'label', label: 'Checkout label', type: 'text', default: 'Card (Stripe)' },
  ],
  gateway: {
    label: (s) => String(s.label || 'Card (Stripe)'),
    async pay(ctx) {
      const secret = String(ctx.settings.secret_key ?? '')
      if (!secret) throw new Error('Stripe is not configured')
      const currency = ctx.invoice.total.currency.toLowerCase()
      const session = await stripe<Session>(secret, 'POST', '/checkout/sessions', {
        mode: 'payment',
        success_url: ctx.returnUrl,
        cancel_url: ctx.cancelUrl,
        customer_email: ctx.user.email,
        client_reference_id: String(ctx.invoice.id),
        metadata: { invoice_id: String(ctx.invoice.id) },
        payment_intent_data: { metadata: { invoice_id: String(ctx.invoice.id) } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: toMinor(ctx.invoice.total.amount, currency),
              product_data: {
                name: `Invoice ${ctx.invoice.number ?? ctx.invoice.id}`,
                description: ctx.invoice.description.slice(0, 500) || undefined,
              },
            },
          },
        ],
      })
      return { redirect: session.url }
    },
  },
  register(api) {
    api.routes(async (request, path) => {
      if (path !== '/webhook' || request.method !== 'POST') return new Response('Not found', { status: 404 })
      const settings = await api.settings()
      const payload = await request.text()
      if (
        !verifyStripeSignature(
          payload,
          request.headers.get('stripe-signature') ?? '',
          String(settings.webhook_secret ?? ''),
        )
      ) {
        return new Response('Invalid signature', { status: 400 })
      }
      const event = JSON.parse(payload) as { type: string; data: { object: Session } }
      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const s = event.data.object
        const invoiceId = Number(s.metadata.invoice_id)
        if (s.payment_status === 'paid' && invoiceId) {
          await api.markInvoicePaid(invoiceId, {
            gateway: 'stripe',
            transactionId: s.payment_intent ?? s.id,
            amount: fromMinor(s.amount_total, s.currency),
          })
          api.log.info(`invoice ${invoiceId} paid`, s.id)
        }
      }
      return Response.json({ received: true })
    })
  },
}
