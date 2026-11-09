import { eq } from 'drizzle-orm'
import { config } from '../config'
import { db, schema } from '../db'
import { mailUser } from './mail'

/** In-app notification (the bell) plus an optional templated email. */
export async function notify(
  userId: number,
  n: { title: string; body?: string; url?: string },
  mail?: { template: string; vars: Record<string, string> },
) {
  await db
    .insert(schema.notifications)
    .values({ userId, title: n.title, body: n.body ?? null, url: n.url ?? null })
  if (mail) await mailUser(userId, mail.template, mail.vars)
}

const money = (amount: string, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(amount))
const day = (d: Date) =>
  d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

async function invoiceVars(invoiceId: number) {
  const { invoiceSummary } = await import('./billing/invoices')
  const invoice = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) })
  const summary = await invoiceSummary(invoiceId)
  if (!invoice || !summary) return null
  return {
    invoice,
    vars: {
      number: invoice.number ?? String(invoice.id),
      total: money(summary.total, invoice.currencyCode),
      due: day(invoice.dueAt),
      url: `${config.url}/invoices/${invoice.id}`,
    },
    total: summary.total,
  }
}

export async function invoiceCreated(invoiceId: number) {
  const v = await invoiceVars(invoiceId)
  if (!v || Number(v.total) <= 0) return
  await notify(
    v.invoice.userId,
    {
      title: `Invoice ${v.vars.number} is ready`,
      body: `${v.vars.total} due ${v.vars.due}`,
      url: `/invoices/${invoiceId}`,
    },
    { template: 'invoice.created', vars: v.vars },
  )
}

export async function invoiceReminder(invoiceId: number) {
  const v = await invoiceVars(invoiceId)
  if (!v) return
  await notify(
    v.invoice.userId,
    { title: `Invoice ${v.vars.number} is due ${v.vars.due}`, url: `/invoices/${invoiceId}` },
    { template: 'invoice.reminder', vars: v.vars },
  )
}

export async function invoicePaid(invoiceId: number) {
  const v = await invoiceVars(invoiceId)
  if (!v || Number(v.total) <= 0) return
  await notify(
    v.invoice.userId,
    { title: `Payment received for ${v.vars.number}`, url: `/invoices/${invoiceId}` },
    { template: 'invoice.paid', vars: v.vars },
  )
}

async function product(serviceId: number) {
  const s = await db.query.services.findFirst({ where: eq(schema.services.id, serviceId) })
  const p = s ? await db.query.products.findFirst({ where: eq(schema.products.id, s.productId) }) : null
  return s && p ? { service: s, name: p.name } : null
}

export async function serviceActivated(serviceId: number) {
  const x = await product(serviceId)
  if (!x) return
  await notify(
    x.service.userId,
    { title: `${x.name} is ready`, url: `/services/${serviceId}` },
    { template: 'service.activated', vars: { product: x.name, url: `${config.url}/services/${serviceId}` } },
  )
}

export async function serviceSuspended(serviceId: number) {
  const x = await product(serviceId)
  if (!x) return
  await notify(
    x.service.userId,
    { title: `${x.name} was suspended`, body: 'Pay the overdue invoice to restore it.', url: '/invoices' },
    { template: 'service.suspended', vars: { product: x.name, url: `${config.url}/invoices` } },
  )
}
