import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { decrypt, safeEqual, verifyPassword } from '../../lib/crypto'
import { HttpError, notFound } from '../../lib/errors'
import { hasPermission } from '../../lib/permissions'
import { buildServerConfiguration, installScript } from '../../services/server-config'
import { validate } from '../validate'

type Node = typeof schema.nodes.$inferSelect
const sftpAttempts = new Map<string, { count: number; resetAt: number }>()

type RemoteEnv = { Variables: { node: Node } }

/** Authenticates daemons with `Bearer <token_id>.<token>`. */
const nodeAuth = createMiddleware<RemoteEnv>(async (c, next) => {
  const raw = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const [tokenId, token] = [raw.slice(0, raw.indexOf('.')), raw.slice(raw.indexOf('.') + 1)]
  const node = tokenId ? await db.query.nodes.findFirst({ where: eq(schema.nodes.tokenId, tokenId) }) : null
  if (!node || !token || !safeEqual(decrypt(node.token), token)) {
    throw new HttpError(403, 'Invalid node credentials', 'forbidden')
  }
  c.set('node', node)
  await next()
})

const serverOnNode = async (node: Node, uuid: string) => {
  const server = await db.query.servers.findFirst({
    where: and(eq(schema.servers.uuid, uuid), eq(schema.servers.nodeId, node.id)),
  })
  if (!server) throw notFound('Server')
  return server
}

export const remoteRoutes = new Hono<RemoteEnv>()
  .use(nodeAuth)
  .post('/heartbeat', async (c) => {
    await db
      .update(schema.nodes)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(schema.nodes.id, c.get('node').id))
    return c.body(null, 204)
  })
  .get('/servers', async (c) => {
    const servers = await db.query.servers.findMany({ where: eq(schema.servers.nodeId, c.get('node').id) })
    return c.json({ data: await Promise.all(servers.map(buildServerConfiguration)) })
  })
  .get('/servers/:uuid', async (c) => {
    const server = await serverOnNode(c.get('node'), c.req.param('uuid'))
    return c.json({ data: await buildServerConfiguration(server) })
  })
  .get('/servers/:uuid/install', async (c) => {
    const server = await serverOnNode(c.get('node'), c.req.param('uuid'))
    return c.json(await installScript(server))
  })
  .post(
    '/servers/:uuid/install',
    validate('json', z.object({ successful: z.boolean(), reinstall: z.boolean().default(false) })),
    async (c) => {
      const server = await serverOnNode(c.get('node'), c.req.param('uuid'))
      const { successful, reinstall } = c.req.valid('json')
      const status = successful ? null : reinstall ? 'reinstall_failed' : 'install_failed'
      await db
        .update(schema.servers)
        .set({
          status: server.status === 'suspended' ? 'suspended' : status,
          installedAt: successful ? new Date() : server.installedAt,
        })
        .where(eq(schema.servers.id, server.id))
      await logActivity({
        event: successful ? 'server:install.completed' : 'server:install.failed',
        subject: { type: 'server', id: server.id },
      })
      return c.body(null, 204)
    },
  )
  .post('/activity', async (c) => c.body(null, 204))

  // SFTP login: "<username>.<server short id>" + panel password or an account SSH key.
  .post(
    '/sftp/auth',
    validate(
      'json',
      z.object({
        type: z.enum(['password', 'public_key']),
        username: z.string().max(200),
        password: z.string().max(8192),
        ip: z.string().max(64).optional(),
      }),
    ),
    async (c) => {
      const { type, username, password, ip } = c.req.valid('json')
      const deny = () => new HttpError(403, 'Invalid credentials', 'forbidden')
      const key = `${ip ?? ''}:${username}`
      const now = Date.now()
      const entry = sftpAttempts.get(key)
      if (entry && entry.resetAt > now && entry.count >= 10)
        throw new HttpError(429, 'Too many attempts', 'throttled')
      const fail = () => {
        const e = sftpAttempts.get(key)
        sftpAttempts.set(
          key,
          e && e.resetAt > now ? { ...e, count: e.count + 1 } : { count: 1, resetAt: now + 60_000 },
        )
        return deny()
      }

      const dot = username.lastIndexOf('.')
      if (dot < 1) throw fail()
      const [name, shortId] = [username.slice(0, dot), username.slice(dot + 1)]
      const user = await db.query.users.findFirst({ where: eq(schema.users.username, name) })
      const server = await db.query.servers.findFirst({
        where: and(eq(schema.servers.uuidShort, shortId), eq(schema.servers.nodeId, c.get('node').id)),
      })
      if (!user || !server || user.suspendedAt) throw fail()

      let ok = false
      if (type === 'password') ok = !!user.password && (await verifyPassword(password, user.password))
      else {
        const keys = await db.query.sshKeys.findMany({ where: eq(schema.sshKeys.userId, user.id) })
        const [algo, data] = password.trim().split(/\s+/)
        ok = keys.some((k) => k.publicKey === `${algo} ${data}`)
      }
      if (!ok) throw fail()
      if (server.status === 'suspended') throw deny()

      let permissions: string[] = []
      const role = user.roleId
        ? await db.query.roles.findFirst({ where: eq(schema.roles.id, user.roleId) })
        : null
      if (server.ownerId === user.id || hasPermission(role?.permissions ?? [], 'admin.servers.manage'))
        permissions = ['*']
      else {
        const sub = await db.query.subusers.findFirst({
          where: and(eq(schema.subusers.serverId, server.id), eq(schema.subusers.userId, user.id)),
        })
        permissions = sub?.permissions ?? []
      }
      if (!hasPermission(permissions, 'file.sftp')) throw deny()
      sftpAttempts.delete(key)
      await logActivity({
        event: 'server:sftp.login',
        actorId: user.id,
        ip: ip ?? null,
        subject: { type: 'server', id: server.id },
        properties: { method: type },
      })
      return c.json({ server: server.uuid, user: user.uuid, permissions })
    },
  )

  // Backup finished on the node.
  .post(
    '/backups/:uuid',
    validate(
      'json',
      z.object({
        successful: z.boolean(),
        checksum: z.string().max(191).optional(),
        checksum_type: z.string().max(16).optional(),
        size: z.number().int().min(0).default(0),
      }),
    ),
    async (c) => {
      const backup = await db.query.backups.findFirst({ where: eq(schema.backups.uuid, c.req.param('uuid')) })
      if (!backup) throw notFound('Backup')
      await serverOnNode(
        c.get('node'),
        (await db.query.servers.findFirst({ where: eq(schema.servers.id, backup.serverId) }))!.uuid,
      )
      const v = c.req.valid('json')
      await db
        .update(schema.backups)
        .set({
          isSuccessful: v.successful,
          checksum: v.checksum ? `${v.checksum_type ?? 'sha256'}:${v.checksum}` : null,
          bytes: v.size,
          completedAt: new Date(),
        })
        .where(eq(schema.backups.id, backup.id))
      await logActivity({
        event: v.successful ? 'server:backup.complete' : 'server:backup.fail',
        subject: { type: 'server', id: backup.serverId },
        properties: { name: backup.name },
      })
      return c.body(null, 204)
    },
  )
  .post('/backups/:uuid/restore', validate('json', z.object({ successful: z.boolean() })), async (c) => {
    const backup = await db.query.backups.findFirst({ where: eq(schema.backups.uuid, c.req.param('uuid')) })
    if (!backup) throw notFound('Backup')
    await db
      .update(schema.servers)
      .set({ status: null })
      .where(and(eq(schema.servers.id, backup.serverId), eq(schema.servers.status, 'restoring_backup')))
    await logActivity({
      event: c.req.valid('json').successful
        ? 'server:backup.restore-complete'
        : 'server:backup.restore-failed',
      subject: { type: 'server', id: backup.serverId },
      properties: { name: backup.name },
    })
    return c.body(null, 204)
  })
