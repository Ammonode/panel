import { and, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { config } from '../../config'
import { db, schema } from '../../db'
import { emit } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { encrypt, hmac, randomToken, safeEqual } from '../../lib/crypto'
import { HttpError } from '../../lib/errors'
import { getSettings, setSettings } from '../../lib/settings'
import { attachReferral, REF_COOKIE } from '../../services/affiliates'
import { authorizeUrl, enabledProviders, exchangeCode, providers, resolveUser } from '../../services/oauth'
import { clientIp, createSession, requireAuth, requirePermission } from '../middleware/auth'
import type { AppEnv } from '../types'
import { validate } from '../validate'

const STATE_COOKIE = 'ammonode_oauth'
const MASK = '••••••••'

/** Errors go back to the page the flow started from. */
const back = (path: string, error: string) => `${config.url}${path}?oauth_error=${encodeURIComponent(error)}`

export const oauthRoutes = new Hono<AppEnv>()
  .get('/oauth/providers', async (c) => c.json({ data: await enabledProviders() }))
  .get('/oauth/:provider/redirect', async (c) => {
    const provider = c.req.param('provider')
    const link = c.req.query('link') === '1' && c.get('user') ? c.get('user')!.id : 0
    const state = randomToken(24)
    // provider + link target are bound to the state and signed with APP_KEY.
    const payload = `${state}.${provider}.${link}`
    setCookie(c, STATE_COOKIE, `${payload}.${hmac(payload)}`, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.url.startsWith('https://'),
      path: '/api/auth/oauth',
      maxAge: 600,
    })
    try {
      return c.redirect(await authorizeUrl(provider, state))
    } catch (e) {
      return c.redirect(back(link ? '/account/security' : '/login', (e as Error).message))
    }
  })
  .get('/oauth/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    const raw = getCookie(c, STATE_COOKIE) ?? ''
    deleteCookie(c, STATE_COOKIE, { path: '/api/auth/oauth' })
    const [state, cookieProvider, link, sig] = raw.split('.')
    const linkTo = Number(link) || null
    const from = linkTo ? '/account/security' : '/login'
    if (
      !state ||
      !sig ||
      !safeEqual(sig, hmac(`${state}.${cookieProvider}.${link}`)) ||
      cookieProvider !== provider ||
      c.req.query('state') !== state
    ) {
      return c.redirect(back(from, 'The sign in request expired or is invalid. Please try again.'))
    }
    if (c.req.query('error')) return c.redirect(back(from, 'Sign in was cancelled.'))
    // Linking requires the same user to still be signed in.
    if (linkTo && c.get('user')?.id !== linkTo)
      return c.redirect(back('/login', 'Sign in again to connect accounts.'))
    try {
      const profile = await exchangeCode(provider, c.req.query('code') ?? '')
      const result = await resolveUser(provider, profile, linkTo)
      if (linkTo) {
        await logActivity({
          event: 'user:oauth.linked',
          actorId: linkTo,
          ip: clientIp(c),
          properties: { provider },
        })
        return c.redirect(`${config.url}/account/security?oauth_linked=${provider}`)
      }
      const user = (await db.query.users.findFirst({ where: eq(schema.users.id, result.userId) }))!
      if (user.suspendedAt) return c.redirect(back('/login', 'This account has been suspended.'))
      if (result.created) {
        await attachReferral(user.id, getCookie(c, REF_COOKIE))
        await emit('user.created', { userId: user.id })
      }
      await createSession(c, user, { pendingTwoFactor: !!user.totpEnabledAt })
      await logActivity({
        event: user.totpEnabledAt ? 'auth:oauth.2fa-required' : 'auth:login',
        actorId: user.id,
        ip: clientIp(c),
        properties: { provider },
      })
      return c.redirect(`${config.url}/${user.totpEnabledAt ? 'login?two_factor=1' : ''}`)
    } catch (e) {
      return c.redirect(back(from, e instanceof HttpError ? e.message : 'Sign in failed, please try again.'))
    }
  })

export const accountOAuthRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => {
    const rows = await db.query.oauthAccounts.findMany({
      where: eq(schema.oauthAccounts.userId, c.get('user')!.id),
    })
    return c.json({
      data: rows.map((r) => ({
        provider: r.provider,
        label: providers[r.provider]?.label ?? r.provider,
        createdAt: r.createdAt,
      })),
      available: await enabledProviders(),
    })
  })
  .delete('/:provider', async (c) => {
    const user = c.get('user')!
    const [{ n }] = (await db
      .select({ n: count() })
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.userId, user.id))) as [{ n: number }]
    // Never remove the last way to sign in.
    if (!user.password && n <= 1)
      throw new HttpError(422, 'Set a password before disconnecting your only sign in method', 'invalid')
    await db
      .delete(schema.oauthAccounts)
      .where(
        and(
          eq(schema.oauthAccounts.userId, user.id),
          eq(schema.oauthAccounts.provider, c.req.param('provider')),
        ),
      )
    await logActivity({
      event: 'user:oauth.unlinked',
      actorId: user.id,
      ip: clientIp(c),
      properties: { provider: c.req.param('provider') },
    })
    return c.json({ ok: true })
  })

const providerKeys = Object.keys(providers)
export const adminOAuthRoutes = new Hono<AppEnv>()
  .get('/oauth', requirePermission('admin.settings.manage'), async (c) => {
    const s = await getSettings(
      providerKeys.flatMap((p) => [`oauth.${p}.enabled`, `oauth.${p}.client_id`, `oauth.${p}.client_secret`]),
    )
    return c.json({
      data: providerKeys.map((p) => ({
        id: p,
        label: providers[p]!.label,
        enabled: s[`oauth.${p}.enabled`] === true,
        clientId: String(s[`oauth.${p}.client_id`] ?? ''),
        clientSecret: s[`oauth.${p}.client_secret`] ? MASK : '',
        callbackUrl: `${config.url}/api/auth/oauth/${p}/callback`,
      })),
    })
  })
  .put(
    '/oauth/:provider',
    requirePermission('admin.settings.manage'),
    validate(
      'json',
      z.object({ enabled: z.boolean(), clientId: z.string().max(512), clientSecret: z.string().max(1024) }),
    ),
    async (c) => {
      const p = c.req.param('provider')
      if (!providers[p]) throw new HttpError(404, 'Unknown provider', 'not_found')
      const v = c.req.valid('json')
      if (v.enabled && (!v.clientId || !v.clientSecret))
        throw new HttpError(422, 'Client ID and secret are required', 'invalid')
      const values: Record<string, unknown> = {
        [`oauth.${p}.enabled`]: v.enabled,
        [`oauth.${p}.client_id`]: v.clientId,
      }
      if (v.clientSecret && v.clientSecret !== MASK)
        values[`oauth.${p}.client_secret`] = encrypt(v.clientSecret)
      await setSettings(values)
      return c.json({ ok: true })
    },
  )
