import type { ExtensionApi, ExtensionManifest, ServerExtension } from '@ammonode/sdk'

export const manifest: ExtensionManifest = {
  id: 'paypal',
  name: 'PayPal',
  type: 'gateway',
  version: '1.0.0',
  description: 'Accept PayPal balance, cards and Pay Later through PayPal Checkout.',
  author: 'Ammonode',
  ammonode: '*',
}

const base = (settings: Record<string, unknown>) =>
  settings.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'

const tokens = new Map<string, { token: string; expires: number }>()

async function accessToken(settings: Record<string, unknown>) {
  const id = String(settings.client_id ?? '')
  const secret = String(settings.client_secret ?? '')
  if (!id || !secret) throw new Error('PayPal is not configured')
  const key = `${base(settings)}:${id}`
  const cached = tokens.get(key)
  if (cached && cached.expires > Date.now()) return cached.token
  const res = await fetch(`${base(settings)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error_description?: string
  }
  if (!res.ok || !data.access_token) throw new Error(`PayPal: ${data.error_description ?? res.statusText}`)
  tokens.set(key, { token: data.access_token, expires: Date.now() + ((data.expires_in ?? 300) - 60) * 1000 })
  return data.access_token
}

async function paypal<T>(
  settings: Record<string, unknown>,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base(settings)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken(settings)}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & {
    message?: string
    details?: { description?: string }[]
  }
  if (!res.ok) throw new Error(`PayPal: ${data.details?.[0]?.description ?? data.message ?? res.statusText}`)
  return data
}

type Capture = {
  id: string
  status: string
  amount: { value: string; currency_code: string }
  custom_id?: string
  seller_receivable_breakdown?: { paypal_fee?: { value: string } }
}
type Order = {
  id: string
  status: string
  links: { rel: string; href: string }[]
  purchase_units: { custom_id?: string; payments?: { captures?: Capture[] } }[]
}

async function recordCaptures(api: ExtensionApi, order: Order) {
  for (const unit of order.purchase_units) {
    for (const capture of unit.payments?.captures ?? []) {
      const invoiceId = Number(capture.custom_id ?? unit.custom_id)
      if (capture.status === 'COMPLETED' && invoiceId) {
        await api.markInvoicePaid(invoiceId, {
          gateway: 'paypal',
          transactionId: capture.id,
          amount: capture.amount.value,
          fee: capture.seller_receivable_breakdown?.paypal_fee?.value,
        })
      }
    }
  }
}

export const extension: ServerExtension = {
  settings: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client secret', type: 'password', required: true },
    {
      key: 'sandbox',
      label: 'Sandbox mode',
      type: 'boolean',
      default: false,
      description: 'Use PayPal sandbox credentials for testing.',
    },
    {
      key: 'webhook_id',
      label: 'Webhook ID',
      type: 'text',
      description:
        'Optional but recommended. Subscribe <panel>/api/extensions/paypal/webhook to PAYMENT.CAPTURE.COMPLETED.',
    },
    { key: 'label', label: 'Checkout label', type: 'text', default: 'PayPal' },
  ],
  gateway: {
    label: (s) => String(s.label || 'PayPal'),
    async pay(ctx) {
      const order = await paypal<Order>(ctx.settings, 'POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: String(ctx.invoice.id),
            custom_id: String(ctx.invoice.id),
            invoice_id: `${ctx.invoice.number ?? ctx.invoice.id}-${Date.now()}`,
            description: `Invoice ${ctx.invoice.number ?? ctx.invoice.id}`,
            amount: {
              currency_code: ctx.invoice.total.currency,
              value: Number(ctx.invoice.total.amount).toFixed(2),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${ctx.extensionUrl}/return?invoice=${ctx.invoice.id}&next=${encodeURIComponent(ctx.returnUrl)}`,
              cancel_url: ctx.cancelUrl,
            },
          },
        },
      })
      const approve = order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')
      if (!approve) throw new Error('PayPal did not return an approval link')
      return { redirect: approve.href }
    },
    async refund(ctx) {
      await paypal(
        ctx.settings,
        'POST',
        `/v2/payments/captures/${encodeURIComponent(ctx.transactionId)}/refund`,
        {
          amount: { value: Number(ctx.amount.amount).toFixed(2), currency_code: ctx.amount.currency },
        },
      )
    },
  },
  register(api) {
    api.routes(async (request, path) => {
      const settings = await api.settings()
      const url = new URL(request.url)

      // Customer comes back after approving: capture the order.
      if (path === '/return' && request.method === 'GET') {
        const orderId = url.searchParams.get('token')
        const next = url.searchParams.get('next') ?? '/'
        const safeNext = next.startsWith(api.url) || next.startsWith('/') ? next : '/'
        if (orderId) {
          try {
            const order = await paypal<Order>(
              settings,
              'POST',
              `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
              {},
            )
            await recordCaptures(api, order)
          } catch (e) {
            // Already captured (e.g. by the webhook) or declined; the invoice page shows the state.
            api.log.error('capture failed', (e as Error).message)
          }
        }
        return Response.redirect(safeNext, 302)
      }

      if (path === '/webhook' && request.method === 'POST') {
        const body = await request.text()
        const event = JSON.parse(body) as { event_type: string; resource: Capture }
        if (settings.webhook_id) {
          const h = (n: string) => request.headers.get(n)
          const check = await paypal<{ verification_status: string }>(
            settings,
            'POST',
            '/v1/notifications/verify-webhook-signature',
            {
              auth_algo: h('paypal-auth-algo'),
              cert_url: h('paypal-cert-url'),
              transmission_id: h('paypal-transmission-id'),
              transmission_sig: h('paypal-transmission-sig'),
              transmission_time: h('paypal-transmission-time'),
              webhook_id: settings.webhook_id,
              webhook_event: JSON.parse(body),
            },
          ).catch(() => ({ verification_status: 'FAILURE' }))
          if (check.verification_status !== 'SUCCESS')
            return new Response('Invalid signature', { status: 400 })
        } else {
          // Without a webhook id we cannot verify the payload: re-fetch the capture from PayPal instead.
          if (event.resource?.id && event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            event.resource = await paypal<Capture>(
              settings,
              'GET',
              `/v2/payments/captures/${encodeURIComponent(event.resource.id)}`,
            )
          }
        }
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && event.resource.status === 'COMPLETED') {
          const invoiceId = Number(event.resource.custom_id)
          if (invoiceId) {
            await api.markInvoicePaid(invoiceId, {
              gateway: 'paypal',
              transactionId: event.resource.id,
              amount: event.resource.amount.value,
              fee: event.resource.seller_receivable_breakdown?.paypal_fee?.value,
            })
          }
        }
        return Response.json({ received: true })
      }
      return new Response('Not found', { status: 404 })
    })
  },
}
