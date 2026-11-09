import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { encrypt } from '../../../lib/crypto'
import { HttpError } from '../../../lib/errors'
import { getSettings, setSettings } from '../../../lib/settings'
import { defaultTemplates, renderTemplate, sendMailNow } from '../../../services/mail'
import { requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { validate } from '../../validate'

const MASK = '••••••••'
const keys = [
  'mail.host',
  'mail.port',
  'mail.username',
  'mail.password',
  'mail.encryption',
  'mail.from_address',
  'mail.from_name',
]

export const adminMailRoutes = new Hono<AppEnv>()
  .get('/mail', requirePermission('admin.settings.manage'), async (c) => {
    const s = await getSettings(keys)
    return c.json({ data: { ...s, 'mail.password': s['mail.password'] ? MASK : '' } })
  })
  .put(
    '/mail',
    requirePermission('admin.settings.manage'),
    validate(
      'json',
      z.object({
        'mail.host': z.string().max(191),
        'mail.port': z.number().int().min(1).max(65535),
        'mail.username': z.string().max(191),
        'mail.password': z.string().max(512),
        'mail.encryption': z.enum(['starttls', 'tls', 'none']),
        'mail.from_address': z.union([z.email(), z.literal('')]),
        'mail.from_name': z.string().max(191),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json')
      const values: Record<string, unknown> = { ...body }
      // Unchanged mask keeps the stored secret; anything else is encrypted.
      if (body['mail.password'] === MASK) delete values['mail.password']
      else if (body['mail.password']) values['mail.password'] = encrypt(body['mail.password'])
      await setSettings(values)
      return c.json({ ok: true })
    },
  )
  .post('/mail/test', requirePermission('admin.settings.manage'), async (c) => {
    const to = c.get('user')!.email
    const rendered = await renderTemplate('auth.verify_email', {
      name: c.get('user')!.username,
      url: 'https://example.com/test',
    })
    try {
      await sendMailNow(to, { ...rendered!, subject: 'Test email from your panel' })
    } catch (e) {
      throw new HttpError(422, `Sending failed: ${(e as Error).message}`, 'mail_failed')
    }
    return c.json({ ok: true, to })
  })
  .get('/email-templates', requirePermission('admin.settings.manage'), async (c) => {
    const custom = await db.query.emailTemplates.findMany()
    return c.json({
      data: Object.entries(defaultTemplates).map(([key, def]) => {
        const o = custom.find((x) => x.key === key)
        return {
          key,
          subject: o?.subject ?? def.subject,
          body: o?.body ?? def.body,
          enabled: o?.enabled ?? true,
          customized: !!o,
          variables: def.variables,
          default: def,
        }
      }),
    })
  })
  .put(
    '/email-templates/:key',
    requirePermission('admin.settings.manage'),
    validate(
      'json',
      z.object({
        subject: z.string().min(1).max(191),
        body: z.string().min(1).max(20000),
        enabled: z.boolean(),
      }),
    ),
    async (c) => {
      const key = c.req.param('key')
      if (!defaultTemplates[key]) throw new HttpError(404, 'Template not found', 'not_found')
      const v = c.req.valid('json')
      await db
        .insert(schema.emailTemplates)
        .values({ key, ...v })
        .onConflictDoUpdate({ target: schema.emailTemplates.key, set: v })
      return c.json({ ok: true })
    },
  )
  .delete('/email-templates/:key', requirePermission('admin.settings.manage'), async (c) => {
    await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.key, c.req.param('key')))
    return c.json({ ok: true })
  })
  .post('/email-templates/:key/preview', requirePermission('admin.settings.manage'), async (c) => {
    const key = c.req.param('key')
    const def = defaultTemplates[key]
    if (!def) throw new HttpError(404, 'Template not found', 'not_found')
    const sample = Object.fromEntries(
      def.variables.map((v) => [v, v === 'url' ? 'https://example.com' : `{${v}}`]),
    )
    const rendered = await renderTemplate(key, sample)
    return c.json({ data: rendered })
  })
