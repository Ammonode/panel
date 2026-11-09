import { and, eq, gt } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { getConnInfo } from 'hono/bun'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { config } from '../../config'
import { db, schema } from '../../db'
import { randomString, randomToken, safeEqual, sha256 } from '../../lib/crypto'
import { forbidden, unauthorized } from '../../lib/errors'
import { hasPermission } from '../../lib/permissions'
import type { AppEnv, User } from '../types'

export const SESSION_COOKIE = 'ammonode_session'
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30

/**
 * Client address. Forwarded headers are only trusted with TRUST_PROXY=true
 * (behind nginx, Caddy or Cloudflare); otherwise anyone could fake them.
 */
export function clientIp(c: Context): string | null {
  if (config.trustProxy) {
    const forwarded =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip')
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c).remote.address ?? null
  } catch {
    return null
  }
}

export async function createSession(
  c: Context,
  user: User,
  opts: { pendingTwoFactor?: boolean; impersonatorId?: number } = {},
) {
  const token = randomToken()
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId: user.id,
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    pendingTwoFactor: opts.pendingTwoFactor ?? false,
    impersonatorId: opts.impersonatorId ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL),
  })
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.url.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL / 1000,
  })
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

async function permissionsFor(user: User): Promise<string[]> {
  if (!user.roleId) return []
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, user.roleId) })
  return role?.permissions ?? []
}

/** Resolves the current user from the session cookie or a `Bearer` API key. */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null)
  c.set('session', null)
  c.set('permissions', [])
  c.set('apiKey', null)

  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (bearer?.startsWith('amn_')) {
    // amn_<identifier 16><secret>
    const identifier = bearer.slice(4, 20)
    const key = await db.query.apiKeys.findFirst({ where: eq(schema.apiKeys.identifier, identifier) })
    if (key && safeEqual(key.tokenHash, sha256(bearer.slice(20)))) {
      const ip = clientIp(c)
      if (key.allowedIps.length && (!ip || !key.allowedIps.includes(ip)))
        throw forbidden('IP address not allowed')
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, key.userId) })
      if (user && !user.suspendedAt) {
        c.set('user', user)
        c.set('apiKey', key)
        c.set('permissions', key.type === 'application' ? await permissionsFor(user) : [])
        db.update(schema.apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiKeys.id, key.id))
          .catch(() => {})
      }
    }
    return next()
  }

  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const session = await db.query.sessions.findFirst({
      where: and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())),
    })
    if (session) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) })
      if (user && !user.suspendedAt) {
        c.set('session', session)
        if (!session.pendingTwoFactor) {
          c.set('user', user)
          c.set('permissions', await permissionsFor(user))
        }
        if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
          db.update(schema.sessions)
            .set({ lastSeenAt: new Date() })
            .where(eq(schema.sessions.id, session.id))
            .catch(() => {})
        }
      }
    }
  }
  await next()
})

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw unauthorized()
  await next()
}

export const requirePermission =
  (permission: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!c.get('user')) throw unauthorized()
    if (!hasPermission(c.get('permissions'), permission)) throw forbidden()
    await next()
  }

export const isAdmin = (permissions: string[]) => permissions.length > 0

export const newUuid = () => crypto.randomUUID()
export const newIdentifier = () => randomString(16)
