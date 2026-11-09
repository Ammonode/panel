import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { config } from '../config'
import { db, schema } from '../db'
import { decrypt } from '../lib/crypto'
import { getSetting, getSettings } from '../lib/settings'
import { defineJob, enqueue } from './queue'

/**
 * Default email templates. Admins can override subject and body in the admin
 * area; bodies are plain text with **bold**, [links](url) and {{variables}}.
 */
export const defaultTemplates: Record<string, { subject: string; body: string; variables: string[] }> = {
  'auth.password_reset': {
    subject: 'Reset your password',
    body: 'Hi {{name}},\n\nSomeone asked to reset the password of your {{app}} account. Use the button below within one hour.\n\n[Reset password]({{url}})\n\nIf this was not you, you can ignore this email.',
    variables: ['name', 'url'],
  },
  'auth.verify_email': {
    subject: 'Confirm your email address',
    body: 'Hi {{name}},\n\nPlease confirm your email address to finish setting up your account.\n\n[Confirm email]({{url}})',
    variables: ['name', 'url'],
  },
  'invoice.created': {
    subject: 'Invoice {{number}} is ready',
    body: 'Hi {{name}},\n\nA new invoice is available.\n\n**Invoice:** {{number}}\n**Amount:** {{total}}\n**Due:** {{due}}\n\n[View and pay]({{url}})\n\nIf you have enough credit it will be paid automatically on the due date.',
    variables: ['name', 'number', 'total', 'due', 'url'],
  },
  'invoice.reminder': {
    subject: 'Reminder: invoice {{number}} is due {{due}}',
    body: 'Hi {{name}},\n\nThis is a reminder that invoice {{number}} of {{total}} is due on {{due}}. Services with unpaid invoices are suspended after the due date.\n\n[Pay now]({{url}})',
    variables: ['name', 'number', 'total', 'due', 'url'],
  },
  'invoice.paid': {
    subject: 'Payment received for invoice {{number}}',
    body: 'Hi {{name}},\n\nThank you! We received your payment of {{total}} for invoice {{number}}.\n\n[View invoice]({{url}})',
    variables: ['name', 'number', 'total', 'url'],
  },
  'service.activated': {
    subject: '{{product}} is ready',
    body: 'Hi {{name}},\n\nYour {{product}} is active and ready to use.\n\n[Open service]({{url}})',
    variables: ['name', 'product', 'url'],
  },
  'service.suspended': {
    subject: '{{product}} has been suspended',
    body: 'Hi {{name}},\n\nYour {{product}} was suspended because its invoice is overdue. Pay the outstanding invoice to restore it right away.\n\n[View invoices]({{url}})',
    variables: ['name', 'product', 'url'],
  },
  'ticket.replied': {
    subject: 'Re: {{subject}} [#{{id}}]',
    body: 'Hi {{name}},\n\n{{staff}} replied to your ticket:\n\n{{message}}\n\n[View ticket]({{url}})',
    variables: ['name', 'subject', 'id', 'staff', 'message', 'url'],
  },
  'ticket.customer_replied': {
    subject: 'Customer replied to #{{id}}: {{subject}}',
    body: '{{customer}} replied to ticket #{{id}}:\n\n{{message}}\n\n[Open ticket]({{url}})',
    variables: ['id', 'subject', 'customer', 'department', 'priority', 'message', 'url'],
  },
  'ticket.created_staff': {
    subject: 'New ticket #{{id}}: {{subject}}',
    body: '{{customer}} opened a ticket in {{department}} with {{priority}} priority:\n\n{{message}}\n\n[Open ticket]({{url}})',
    variables: ['id', 'subject', 'customer', 'department', 'priority', 'message', 'url'],
  },
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function interpolate(text: string, vars: Record<string, string>, escapeValues = false) {
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, k: string) => {
    const v = vars[k] ?? ''
    return escapeValues ? escapeHtml(v) : v
  })
}

/** Very small markup: paragraphs, **bold**, [button](url). Variables are escaped. */
function toHtml(body: string, vars: Record<string, string>, accent: string) {
  return interpolate(escapeHtml(body), vars, true)
    .split(/\n{2,}/)
    .map((p) => {
      const button = p.trim().match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (button) {
        return `<p style="margin:24px 0"><a href="${button[2]}" style="background:${accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${button[1]}</a></p>`
      }
      const html = p
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${accent}">$1</a>`)
        .replace(/\n/g, '<br>')
      return `<p style="margin:0 0 16px">${html}</p>`
    })
    .join('')
}

const toText = (body: string, vars: Record<string, string>) =>
  interpolate(body, vars)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')

export async function renderTemplate(key: string, vars: Record<string, string>) {
  const def = defaultTemplates[key]
  if (!def) throw new Error(`Unknown email template ${key}`)
  const custom = await db.query.emailTemplates.findFirst({ where: eq(schema.emailTemplates.key, key) })
  if (custom && !custom.enabled) return null
  const appName = String(await getSetting('app.name'))
  const all = { app: appName, ...vars }
  const subject = interpolate(custom?.subject ?? def.subject, all)
  const body = custom?.body ?? def.body
  const accent = '#1c1f2b'
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1d27">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-size:18px;font-weight:600">${escapeHtml(appName)}</td></tr>
<tr><td style="background:#fff;border:1px solid #e6e7eb;border-radius:14px;padding:28px;font-size:14px;line-height:1.6">${toHtml(body, all, accent)}</td></tr>
<tr><td style="padding:16px 4px;font-size:12px;color:#9a9eab">${escapeHtml(appName)} · ${escapeHtml(config.url)}</td></tr>
</table></td></tr></table></body></html>`
  return { subject, html, text: toText(body, all) }
}

async function transport() {
  const s = await getSettings([
    'mail.host',
    'mail.port',
    'mail.username',
    'mail.password',
    'mail.encryption',
    'mail.from_address',
    'mail.from_name',
  ])
  const host = (s['mail.host'] as string) || config.mail.host
  if (!host) return null
  const encryption = (s['mail.encryption'] as string) || 'starttls'
  let password = config.mail.password
  if (s['mail.password']) {
    try {
      password = decrypt(String(s['mail.password']))
    } catch {}
  }
  const port = Number(s['mail.port'] || config.mail.port)
  const user = (s['mail.username'] as string) || config.mail.username
  return {
    from: {
      address: (s['mail.from_address'] as string) || config.mail.from.address,
      name: (s['mail.from_name'] as string) || config.mail.from.name,
    },
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: encryption === 'tls',
      ignoreTLS: encryption === 'none',
      requireTLS: encryption === 'starttls',
      auth: user ? { user, pass: password } : undefined,
      connectionTimeout: 15_000,
    }),
  }
}

export async function sendMailNow(to: string, message: { subject: string; html: string; text: string }) {
  const t = await transport()
  if (!t) throw new Error('Email is not configured (Admin → Settings → Email)')
  await t.transporter.sendMail({
    from: t.from,
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  })
}

/** Queues a templated email. Silently does nothing when mail is not configured. */
export async function sendTemplate(to: string, key: string, vars: Record<string, string>) {
  await enqueue('mail.send', { to, key, vars })
}

/** Convenience: email a user by id with their display name filled in. */
export async function mailUser(userId: number, key: string, vars: Record<string, string>) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) })
  if (!user) return
  await sendTemplate(user.email, key, { name: user.firstName || user.username, ...vars })
}

defineJob('mail.send', async (p) => {
  if (!(await transport())) return // not configured: drop quietly
  const rendered = await renderTemplate(String(p.key), p.vars as Record<string, string>)
  if (!rendered) return // template disabled
  await sendMailNow(String(p.to), rendered)
})
