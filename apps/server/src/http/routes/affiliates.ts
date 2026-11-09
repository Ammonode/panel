import { desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { config } from '../../config'
import { db, schema } from '../../db'
import { randomString } from '../../lib/crypto'
import { HttpError } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { REF_COOKIE } from '../../services/affiliates'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

const mask = (email: string) => {
  const [name = '', domain = ''] = email.split('@')
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`
}

export const affiliateRoutes = new Hono<AppEnv>()
  // Called by the web app when a visitor arrives with ?ref=CODE.
  .post('/visit/:code', async (c) => {
    if (!(await getSetting('affiliates.enabled'))) return c.json({ ok: false })
    const code = c.req.param('code')
    const affiliate = await db.query.affiliates.findFirst({ where: eq(schema.affiliates.code, code) })
    if (!affiliate) return c.json({ ok: false })
    // Count each browser once.
    if (getCookie(c, REF_COOKIE) !== code) {
      await db
        .update(schema.affiliates)
        .set({ visitors: sql`${schema.affiliates.visitors} + 1` })
        .where(eq(schema.affiliates.id, affiliate.id))
      setCookie(c, REF_COOKIE, code, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: config.url.startsWith('https://'),
        path: '/',
        maxAge: 30 * 86400,
      })
    }
    return c.json({ ok: true })
  })
  .use('/me/*', requireAuth)
  .use('/me', requireAuth)
  .get('/me', async (c) => {
    const user = c.get('user')!
    const enabled = await getSetting('affiliates.enabled')
    const affiliate = await db.query.affiliates.findFirst({ where: eq(schema.affiliates.userId, user.id) })
    if (!affiliate)
      return c.json({ data: null, enabled, percent: await getSetting('affiliates.reward_percent') })
    const referrals = await db
      .select({ ref: schema.affiliateReferrals, email: schema.users.email })
      .from(schema.affiliateReferrals)
      .innerJoin(schema.users, eq(schema.users.id, schema.affiliateReferrals.userId))
      .where(eq(schema.affiliateReferrals.affiliateId, affiliate.id))
      .orderBy(desc(schema.affiliateReferrals.id))
    const earnings: Record<string, number> = {}
    for (const r of referrals)
      for (const [cur, v] of Object.entries(r.ref.earnings)) earnings[cur] = (earnings[cur] ?? 0) + Number(v)
    return c.json({
      enabled,
      percent: Number(affiliate.rewardPercent ?? (await getSetting('affiliates.reward_percent'))),
      data: {
        code: affiliate.code,
        link: `${config.url}/register?ref=${affiliate.code}`,
        visitors: affiliate.visitors,
        signups: referrals.length,
        earnings: Object.fromEntries(Object.entries(earnings).map(([k, v]) => [k, v.toFixed(2)])),
        referrals: referrals.map((r) => ({
          email: mask(r.email),
          earnings: r.ref.earnings,
          joinedAt: r.ref.createdAt,
        })),
      },
    })
  })
  .post('/me', async (c) => {
    if (!(await getSetting('affiliates.enabled')))
      throw new HttpError(403, 'The affiliate program is not available', 'forbidden')
    const user = c.get('user')!
    const existing = await db.query.affiliates.findFirst({ where: eq(schema.affiliates.userId, user.id) })
    if (existing) return c.json({ ok: true })
    await db.insert(schema.affiliates).values({ userId: user.id, code: randomString(8).toLowerCase() })
    return c.json({ ok: true }, 201)
  })
