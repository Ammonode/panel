import { and, desc, eq, isNotNull, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { notFound } from '../../lib/errors'
import { requirePermission } from '../middleware/auth'
import type { AppEnv } from '../types'
import { onlyProvided, validate } from '../validate'

const visible = () =>
  and(
    eq(schema.announcements.isActive, true),
    isNotNull(schema.announcements.publishedAt),
    lte(schema.announcements.publishedAt, new Date()),
  )

const body = z.object({
  title: z.string().min(1).max(191),
  slug: z
    .string()
    .min(1)
    .max(191)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(500).nullish(),
  content: z.string().min(1).max(50000),
  isActive: z.boolean().default(true),
  publishedAt: z.coerce.date().nullish(),
})

export const announcementRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await db.query.announcements.findMany({
      where: visible(),
      orderBy: desc(schema.announcements.publishedAt),
      limit: 50,
    })
    return c.json({ data: rows })
  })
  .get('/:slug', async (c) => {
    const row = await db.query.announcements.findFirst({
      where: and(visible(), eq(schema.announcements.slug, c.req.param('slug'))),
    })
    if (!row) throw notFound('Announcement')
    return c.json({ data: row })
  })

export const adminAnnouncementRoutes = new Hono<AppEnv>()
  .get('/announcements', requirePermission('admin.announcements.manage'), async (c) =>
    c.json({ data: await db.query.announcements.findMany({ orderBy: desc(schema.announcements.id) }) }),
  )
  .post(
    '/announcements',
    requirePermission('admin.announcements.manage'),
    validate('json', body),
    async (c) => {
      const v = c.req.valid('json')
      const [row] = await db
        .insert(schema.announcements)
        .values({ ...v, publishedAt: v.publishedAt ?? new Date() })
        .returning()
      return c.json({ data: row }, 201)
    },
  )
  .patch(
    '/announcements/:id',
    requirePermission('admin.announcements.manage'),
    validate('json', body.partial()),
    async (c) => {
      const [row] = await db
        .update(schema.announcements)
        .set(await onlyProvided(c, c.req.valid('json')))
        .where(eq(schema.announcements.id, Number(c.req.param('id'))))
        .returning()
      if (!row) throw notFound('Announcement')
      return c.json({ data: row })
    },
  )
  .delete('/announcements/:id', requirePermission('admin.announcements.manage'), async (c) => {
    await db.delete(schema.announcements).where(eq(schema.announcements.id, Number(c.req.param('id'))))
    return c.json({ ok: true })
  })
