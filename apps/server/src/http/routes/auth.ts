import { and, eq, isNull, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { db, schema } from '../../db'
import { emit } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { decrypt, hashPassword, sha256, verifyPassword } from '../../lib/crypto'
import { HttpError } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { verifyTotp } from '../../lib/totp'
import { attachReferral, REF_COOKIE } from '../../services/affiliates'
import { consume, sendPasswordReset, sendVerification } from '../../services/auth-tokens'
import { clientIp, createSession, destroySession, newUuid } from '../middleware/auth'
import { serializeUser } from '../serializers'
import type { AppEnv } from '../types'
import { validate } from '../validate'

const attempts = new Map<string, { count: number; resetAt: number }>()
function throttle(key: string, max = 8, windowMs = 60_000) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) return attempts.set(key, { count: 1, resetAt: now + windowMs })
  if (++entry.count > max) throw new HttpError(429, 'Too many attempts, please try again later.', 'throttled')
}

export const authRoutes = new Hono<AppEnv>()
  .get('/me', (c) => {
    const user = c.get('user')
    const session = c.get('session')
    return c.json({
      user: user ? serializeUser(user, c.get('permissions')) : null,
      twoFactorPending: !user && !!session?.pendingTwoFactor,
      impersonating: !!session?.impersonatorId,
    })
  })

  .post(
    '/register',
    validate(
      'json',
      z.object({
        email: z.email().max(191),
        username: z
          .string()
          .min(3)
          .max(64)
          .regex(/^[a-zA-Z0-9_.-]+$/),
        firstName: z.string().max(64).optional(),
        lastName: z.string().max(64).optional(),
        password: z.string().min(8).max(256),
      }),
    ),
    async (c) => {
      if (!(await getSetting('auth.registration')))
        throw new HttpError(403, 'Registration is disabled', 'forbidden')
      throttle(`register:${clientIp(c)}`, 5)
      const body = c.req.valid('json')
      const email = body.email.toLowerCase()
      const exists = await db.query.users.findFirst({
        where: or(eq(schema.users.email, email), eq(schema.users.username, body.username)),
      })
      if (exists) throw new HttpError(409, 'Email or username is already taken', 'taken')
      const [user] = await db
        .insert(schema.users)
        .values({ ...body, email, uuid: newUuid(), password: await hashPassword(body.password) })
        .returning()
      await createSession(c, user!)
      await logActivity({ event: 'auth:register', actorId: user!.id, ip: clientIp(c) })
      await sendVerification(user!.id)
      await attachReferral(user!.id, getCookie(c, REF_COOKIE))
      await emit('user.created', { userId: user!.id })
      return c.json({ user: serializeUser(user!) }, 201)
    },
  )

  .post(
    '/login',
    validate('json', z.object({ login: z.string().min(1), password: z.string().min(1) })),
    async (c) => {
      const { login, password } = c.req.valid('json')
      throttle(`login:${clientIp(c)}:${login.toLowerCase()}`)
      const user = await db.query.users.findFirst({
        where: or(eq(schema.users.email, login.toLowerCase()), eq(schema.users.username, login)),
      })
      if (!user?.password || !(await verifyPassword(password, user.password))) {
        throw new HttpError(422, 'These credentials do not match our records.', 'invalid_credentials')
      }
      if (user.suspendedAt) throw new HttpError(403, 'This account has been suspended.', 'suspended')
      const pending = !!user.totpEnabledAt
      await createSession(c, user, { pendingTwoFactor: pending })
      if (!pending) await logActivity({ event: 'auth:login', actorId: user.id, ip: clientIp(c) })
      return c.json({ twoFactorRequired: pending })
    },
  )

  .post('/login/2fa', validate('json', z.object({ code: z.string().min(6).max(32) })), async (c) => {
    const session = c.get('session')
    if (!session?.pendingTwoFactor) throw new HttpError(400, 'No pending login', 'invalid')
    throttle(`2fa:${session.id}`, 5)
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) })
    const { code } = c.req.valid('json')
    let ok = !!user?.totpSecret && verifyTotp(decrypt(user.totpSecret), code)
    if (!ok && user) {
      const recovery = await db.query.recoveryCodes.findFirst({
        where: and(
          eq(schema.recoveryCodes.userId, user.id),
          eq(schema.recoveryCodes.code, sha256(code.trim())),
          isNull(schema.recoveryCodes.usedAt),
        ),
      })
      if (recovery) {
        await db
          .update(schema.recoveryCodes)
          .set({ usedAt: new Date() })
          .where(eq(schema.recoveryCodes.id, recovery.id))
        ok = true
      }
    }
    if (!ok || !user) throw new HttpError(422, 'The two-factor code is invalid.', 'invalid_code')
    await db
      .update(schema.sessions)
      .set({ pendingTwoFactor: false })
      .where(eq(schema.sessions.id, session.id))
    await logActivity({
      event: 'auth:login',
      actorId: user.id,
      ip: clientIp(c),
      properties: { twoFactor: true },
    })
    return c.json({ ok: true })
  })

  .post('/forgot-password', validate('json', z.object({ email: z.email() })), async (c) => {
    const email = c.req.valid('json').email.toLowerCase()
    throttle(`forgot:${clientIp(c)}`, 5, 15 * 60_000)
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) })
    // Same answer whether or not the account exists, so emails cannot be enumerated.
    if (user && !user.suspendedAt) {
      await sendPasswordReset(user.id)
      await logActivity({ event: 'auth:password.reset-requested', actorId: user.id, ip: clientIp(c) })
    }
    return c.json({ ok: true })
  })
  .post(
    '/reset-password',
    validate('json', z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(256) })),
    async (c) => {
      throttle(`reset:${clientIp(c)}`, 10, 15 * 60_000)
      const { token, password } = c.req.valid('json')
      const userId = await consume(token, 'password_reset')
      if (!userId)
        throw new HttpError(
          422,
          'This reset link is invalid or has expired. Request a new one.',
          'invalid_token',
        )
      await db
        .update(schema.users)
        .set({ password: await hashPassword(password) })
        .where(eq(schema.users.id, userId))
      // Sign out every session: whoever had the old password loses access.
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
      await logActivity({ event: 'auth:password.reset', actorId: userId, ip: clientIp(c) })
      return c.json({ ok: true })
    },
  )
  .post('/verify-email', validate('json', z.object({ token: z.string().min(20).max(200) })), async (c) => {
    const userId = await consume(c.req.valid('json').token, 'verify_email')
    if (!userId)
      throw new HttpError(422, 'This verification link is invalid or has expired.', 'invalid_token')
    await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId))
    return c.json({ ok: true })
  })

  .post('/logout', async (c) => {
    await destroySession(c)
    return c.json({ ok: true })
  })
