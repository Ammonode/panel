import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { decrypt, encrypt, hashPassword, randomString, sha256, verifyPassword } from '../../lib/crypto'
import { HttpError, notFound } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp'
import { clientIp, newIdentifier, requireAuth } from '../middleware/auth'
import { serializeUser } from '../serializers'
import type { AppEnv } from '../types'
import { validate } from '../validate'

export const accountRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .patch(
    '/',
    validate(
      'json',
      z.object({
        firstName: z.string().max(64).nullable().optional(),
        lastName: z.string().max(64).nullable().optional(),
        language: z.string().max(8).optional(),
        theme: z.enum(['system', 'light', 'dark']).optional(),
      }),
    ),
    async (c) => {
      const [user] = await db
        .update(schema.users)
        .set(c.req.valid('json'))
        .where(eq(schema.users.id, c.get('user')!.id))
        .returning()
      return c.json({ user: serializeUser(user!, c.get('permissions')) })
    },
  )

  .put(
    '/email',
    validate('json', z.object({ email: z.email().max(191), password: z.string() })),
    async (c) => {
      const user = c.get('user')!
      const { email, password } = c.req.valid('json')
      if (!user.password || !(await verifyPassword(password, user.password)))
        throw new HttpError(422, 'Password is incorrect', 'invalid_password')
      const taken = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) })
      if (taken && taken.id !== user.id) throw new HttpError(409, 'Email is already taken', 'taken')
      await db
        .update(schema.users)
        .set({ email: email.toLowerCase(), emailVerifiedAt: null })
        .where(eq(schema.users.id, user.id))
      await logActivity({
        event: 'user:account.email-changed',
        actorId: user.id,
        ip: clientIp(c),
        properties: { old: user.email, new: email },
      })
      return c.json({ ok: true })
    },
  )

  .put(
    '/password',
    validate('json', z.object({ currentPassword: z.string(), password: z.string().min(8).max(256) })),
    async (c) => {
      const user = c.get('user')!
      const { currentPassword, password } = c.req.valid('json')
      if (!user.password || !(await verifyPassword(currentPassword, user.password)))
        throw new HttpError(422, 'Password is incorrect', 'invalid_password')
      await db
        .update(schema.users)
        .set({ password: await hashPassword(password) })
        .where(eq(schema.users.id, user.id))
      await logActivity({ event: 'user:account.password-changed', actorId: user.id, ip: clientIp(c) })
      return c.json({ ok: true })
    },
  )

  // Two-factor authentication
  .get('/two-factor', async (c) => {
    const user = c.get('user')!
    if (user.totpEnabledAt) throw new HttpError(409, 'Two-factor is already enabled', 'enabled')
    const secret = generateTotpSecret()
    await db
      .update(schema.users)
      .set({ totpSecret: encrypt(secret) })
      .where(eq(schema.users.id, user.id))
    return c.json({ secret, uri: totpUri(secret, user.email, await getSetting('app.name')) })
  })
  .post(
    '/two-factor',
    validate('json', z.object({ code: z.string().length(6), password: z.string() })),
    async (c) => {
      const user = c.get('user')!
      const { code, password } = c.req.valid('json')
      if (!user.password || !(await verifyPassword(password, user.password)))
        throw new HttpError(422, 'Password is incorrect', 'invalid_password')
      if (!user.totpSecret || !verifyTotp(decrypt(user.totpSecret), code))
        throw new HttpError(422, 'The code is invalid', 'invalid_code')
      const codes = Array.from({ length: 10 }, () => randomString(10))
      await db.transaction(async (tx) => {
        await tx.update(schema.users).set({ totpEnabledAt: new Date() }).where(eq(schema.users.id, user.id))
        await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, user.id))
        await tx
          .insert(schema.recoveryCodes)
          .values(codes.map((code) => ({ userId: user.id, code: sha256(code) })))
      })
      await logActivity({ event: 'user:two-factor.create', actorId: user.id, ip: clientIp(c) })
      return c.json({ recoveryCodes: codes })
    },
  )
  .delete('/two-factor', validate('json', z.object({ password: z.string() })), async (c) => {
    const user = c.get('user')!
    if (!user.password || !(await verifyPassword(c.req.valid('json').password, user.password)))
      throw new HttpError(422, 'Password is incorrect', 'invalid_password')
    await db
      .update(schema.users)
      .set({ totpEnabledAt: null, totpSecret: null })
      .where(eq(schema.users.id, user.id))
    await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, user.id))
    await logActivity({ event: 'user:two-factor.delete', actorId: user.id, ip: clientIp(c) })
    return c.json({ ok: true })
  })

  // API keys
  .get('/api-keys', async (c) => {
    const keys = await db.query.apiKeys.findMany({
      where: eq(schema.apiKeys.userId, c.get('user')!.id),
      orderBy: desc(schema.apiKeys.id),
    })
    return c.json({ data: keys.map(({ tokenHash: _, ...k }) => k) })
  })
  .post(
    '/api-keys',
    validate(
      'json',
      z.object({
        description: z.string().min(1).max(191),
        allowedIps: z.array(z.string()).max(50).default([]),
      }),
    ),
    async (c) => {
      const user = c.get('user')!
      const identifier = newIdentifier()
      const secret = randomString(32)
      const [key] = await db
        .insert(schema.apiKeys)
        .values({ userId: user.id, identifier, tokenHash: sha256(secret), ...c.req.valid('json') })
        .returning()
      await logActivity({
        event: 'user:api-key.create',
        actorId: user.id,
        ip: clientIp(c),
        properties: { identifier },
      })
      return c.json({ data: { ...key, tokenHash: undefined }, token: `amn_${identifier}${secret}` }, 201)
    },
  )
  .delete('/api-keys/:identifier', async (c) => {
    const user = c.get('user')!
    const res = await db
      .delete(schema.apiKeys)
      .where(
        and(eq(schema.apiKeys.userId, user.id), eq(schema.apiKeys.identifier, c.req.param('identifier'))),
      )
      .returning()
    if (!res.length) throw notFound('API key')
    await logActivity({
      event: 'user:api-key.delete',
      actorId: user.id,
      ip: clientIp(c),
      properties: { identifier: c.req.param('identifier') },
    })
    return c.json({ ok: true })
  })

  // SSH keys (SFTP)
  .get('/ssh-keys', async (c) =>
    c.json({
      data: await db.query.sshKeys.findMany({ where: eq(schema.sshKeys.userId, c.get('user')!.id) }),
    }),
  )
  .post(
    '/ssh-keys',
    validate('json', z.object({ name: z.string().min(1).max(191), publicKey: z.string().min(20) })),
    async (c) => {
      const { name, publicKey } = c.req.valid('json')
      const parts = publicKey.trim().split(/\s+/)
      if (parts.length < 2 || !/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521))$/.test(parts[0]!)) {
        throw new HttpError(422, 'The public key is not a valid OpenSSH key', 'invalid')
      }
      const raw = Buffer.from(parts[1]!, 'base64')
      const fingerprint = `SHA256:${new Bun.CryptoHasher('sha256').update(raw).digest('base64').replace(/=+$/, '')}`
      const [key] = await db
        .insert(schema.sshKeys)
        .values({ userId: c.get('user')!.id, name, publicKey: `${parts[0]} ${parts[1]}`, fingerprint })
        .returning()
      return c.json({ data: key }, 201)
    },
  )
  .delete('/ssh-keys/:id', async (c) => {
    await db
      .delete(schema.sshKeys)
      .where(
        and(eq(schema.sshKeys.userId, c.get('user')!.id), eq(schema.sshKeys.id, Number(c.req.param('id')))),
      )
    return c.json({ ok: true })
  })

  // Sessions
  .get('/sessions', async (c) => {
    const rows = await db.query.sessions.findMany({
      where: eq(schema.sessions.userId, c.get('user')!.id),
      orderBy: desc(schema.sessions.lastSeenAt),
    })
    const current = c.get('session')?.id
    return c.json({
      data: rows.map((s) => ({
        id: s.id.slice(0, 12),
        ip: s.ip,
        userAgent: s.userAgent,
        lastSeenAt: s.lastSeenAt,
        current: s.id === current,
      })),
    })
  })

  .get('/activity', async (c) => {
    const rows = await db.query.activityLogs.findMany({
      where: eq(schema.activityLogs.actorId, c.get('user')!.id),
      orderBy: desc(schema.activityLogs.id),
      limit: 50,
    })
    return c.json({ data: rows })
  })
