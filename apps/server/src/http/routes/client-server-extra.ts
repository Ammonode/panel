import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { HttpError, notFound } from '../../lib/errors'
import { allServerPermissions } from '../../lib/permissions'
import { daemonRequest, signDaemonToken } from '../../services/daemon'
import { createDatabase, deleteDatabase, rotatePassword, serializeDatabase } from '../../services/databases'
import { nextRun, runSchedule } from '../../services/schedules'
import { validate } from '../validate'
import { cleanPath, daemonBase, type Env, log } from './client-server'

const intId = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}

const cronField = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\d*,/-]+$/, 'Invalid cron value')
const scheduleBody = z.object({
  name: z.string().min(1).max(191),
  cronMinute: cronField,
  cronHour: cronField,
  cronDayOfMonth: cronField,
  cronMonth: cronField,
  cronDayOfWeek: cronField,
  isActive: z.boolean().default(true),
  onlyWhenOnline: z.boolean().default(false),
})
const taskBody = z.object({
  action: z.enum(['command', 'power', 'backup']),
  payload: z.string().max(4096).default(''),
  timeOffset: z.number().int().min(0).max(900).default(0),
  continueOnFailure: z.boolean().default(false),
})

/**
 * Mounted on the same prefix right after `clientServerRoutes`, whose auth and
 * `/:server/*` access middleware also run for these routes.
 */
export const clientServerExtraRoutes = new Hono<Env>()

  // ── More file operations ─────────────────────────────────
  .post(
    '/:server/files/compress',
    validate(
      'json',
      z.object({ root: z.string().default('/'), files: z.array(z.string()).min(1).max(1000) }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('file.archive')
      a.requireReady()
      const body = c.req.valid('json')
      const data = await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/compress`, {
        ...body,
        root: cleanPath(body.root),
      })
      await log(c, a, 'server:file.compress', body)
      return c.json({ data })
    },
  )
  .post(
    '/:server/files/decompress',
    validate('json', z.object({ root: z.string().default('/'), file: z.string().min(1) })),
    async (c) => {
      const a = c.get('access')
      a.require('file.archive')
      a.requireReady()
      const body = c.req.valid('json')
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/decompress`, {
        ...body,
        root: cleanPath(body.root),
      })
      await log(c, a, 'server:file.decompress', body)
      return c.body(null, 204)
    },
  )
  .post(
    '/:server/files/chmod',
    validate(
      'json',
      z.object({
        root: z.string().default('/'),
        files: z.array(z.object({ file: z.string(), mode: z.string().regex(/^[0-7]{3}$/) })).min(1),
      }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('file.update')
      a.requireReady()
      const body = c.req.valid('json')
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/chmod`, {
        ...body,
        root: cleanPath(body.root),
      })
      return c.body(null, 204)
    },
  )
  .post(
    '/:server/files/pull',
    validate(
      'json',
      z.object({
        url: z.url().max(2048),
        directory: z.string().default('/'),
        filename: z.string().max(255).optional(),
      }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('file.create')
      a.requireReady()
      const body = c.req.valid('json')
      const data = await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/pull`, {
        ...body,
        directory: cleanPath(body.directory),
      })
      await log(c, a, 'server:file.pull', { url: body.url, directory: body.directory })
      return c.json({ data })
    },
  )
  .get('/:server/files/upload', async (c) => {
    const a = c.get('access')
    a.require('file.create')
    a.requireReady()
    const token = await signDaemonToken(
      a.node,
      { server_uuid: a.server.uuid, user_uuid: c.get('user')!.uuid },
      900,
    )
    return c.json({
      data: { url: `${a.node.scheme}://${a.node.fqdn}:${a.node.daemonListen}/upload/file?token=${token}` },
    })
  })

  // ── Backups ──────────────────────────────────────────────
  .get('/:server/backups', async (c) => {
    const a = c.get('access')
    a.require('backup.read')
    const rows = await db.query.backups.findMany({
      where: eq(schema.backups.serverId, a.server.id),
      orderBy: desc(schema.backups.id),
    })
    return c.json({ data: rows, limit: a.server.backupLimit })
  })
  .post(
    '/:server/backups',
    validate(
      'json',
      z.object({
        name: z.string().max(191).optional(),
        ignored: z.string().max(10000).default(''),
        isLocked: z.boolean().default(false),
      }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('backup.create')
      a.requireReady()
      const [{ n }] = (await db
        .select({ n: count() })
        .from(schema.backups)
        .where(eq(schema.backups.serverId, a.server.id))) as [{ n: number }]
      if (n >= a.server.backupLimit)
        throw new HttpError(
          422,
          a.server.backupLimit
            ? `This server is limited to ${a.server.backupLimit} backups. Delete one first.`
            : 'Backups are not available for this server.',
          'limit',
        )
      const running = await db.query.backups.findFirst({
        where: and(eq(schema.backups.serverId, a.server.id), eq(schema.backups.isSuccessful, false)),
      })
      if (running && !running.completedAt)
        throw new HttpError(409, 'Another backup is still running', 'conflict')
      const body = c.req.valid('json')
      const [backup] = await db
        .insert(schema.backups)
        .values({
          uuid: crypto.randomUUID(),
          serverId: a.server.id,
          name: body.name || `Backup ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          ignoredFiles: body.ignored,
          isLocked: body.isLocked,
        })
        .returning()
      try {
        await daemonRequest(a.node, 'POST', `${daemonBase(a)}/backup`, {
          uuid: backup!.uuid,
          ignore: body.ignored,
        })
      } catch (e) {
        await db.delete(schema.backups).where(eq(schema.backups.id, backup!.id))
        throw e
      }
      await log(c, a, 'server:backup.start', { name: backup!.name })
      return c.json({ data: backup }, 201)
    },
  )
  .post('/:server/backups/:backup/lock', async (c) => {
    const a = c.get('access')
    a.require('backup.delete')
    const b = await db.query.backups.findFirst({
      where: and(eq(schema.backups.serverId, a.server.id), eq(schema.backups.uuid, c.req.param('backup'))),
    })
    if (!b) throw notFound('Backup')
    await db.update(schema.backups).set({ isLocked: !b.isLocked }).where(eq(schema.backups.id, b.id))
    return c.json({ ok: true })
  })
  .get('/:server/backups/:backup/download', async (c) => {
    const a = c.get('access')
    a.require('backup.download')
    const b = await db.query.backups.findFirst({
      where: and(eq(schema.backups.serverId, a.server.id), eq(schema.backups.uuid, c.req.param('backup'))),
    })
    if (!b?.isSuccessful) throw notFound('Backup')
    const token = await signDaemonToken(a.node, { server_uuid: a.server.uuid, backup_uuid: b.uuid }, 300)
    await log(c, a, 'server:backup.download', { name: b.name })
    return c.json({
      data: {
        url: `${a.node.scheme}://${a.node.fqdn}:${a.node.daemonListen}/download/backup?token=${token}`,
      },
    })
  })
  .post(
    '/:server/backups/:backup/restore',
    validate('json', z.object({ truncate: z.boolean().default(false) })),
    async (c) => {
      const a = c.get('access')
      a.require('backup.restore')
      a.requireReady()
      const b = await db.query.backups.findFirst({
        where: and(eq(schema.backups.serverId, a.server.id), eq(schema.backups.uuid, c.req.param('backup'))),
      })
      if (!b?.isSuccessful) throw notFound('Backup')
      await db
        .update(schema.servers)
        .set({ status: 'restoring_backup' })
        .where(eq(schema.servers.id, a.server.id))
      try {
        await daemonRequest(a.node, 'POST', `${daemonBase(a)}/backup/${b.uuid}/restore`, c.req.valid('json'))
      } catch (e) {
        await db.update(schema.servers).set({ status: null }).where(eq(schema.servers.id, a.server.id))
        throw e
      }
      await log(c, a, 'server:backup.restore', { name: b.name, truncate: c.req.valid('json').truncate })
      return c.body(null, 204)
    },
  )
  .delete('/:server/backups/:backup', async (c) => {
    const a = c.get('access')
    a.require('backup.delete')
    const b = await db.query.backups.findFirst({
      where: and(eq(schema.backups.serverId, a.server.id), eq(schema.backups.uuid, c.req.param('backup'))),
    })
    if (!b) throw notFound('Backup')
    if (b.isLocked) throw new HttpError(422, 'Unlock this backup before deleting it', 'locked')
    await daemonRequest(a.node, 'DELETE', `${daemonBase(a)}/backup/${b.uuid}`)
    await db.delete(schema.backups).where(eq(schema.backups.id, b.id))
    await log(c, a, 'server:backup.delete', { name: b.name })
    return c.body(null, 204)
  })

  // ── Subusers ─────────────────────────────────────────────
  .get('/:server/users', async (c) => {
    const a = c.get('access')
    a.require('user.read')
    const rows = await db
      .select({
        sub: schema.subusers,
        user: {
          uuid: schema.users.uuid,
          email: schema.users.email,
          username: schema.users.username,
          totp: schema.users.totpEnabledAt,
        },
      })
      .from(schema.subusers)
      .innerJoin(schema.users, eq(schema.users.id, schema.subusers.userId))
      .where(eq(schema.subusers.serverId, a.server.id))
      .orderBy(asc(schema.subusers.id))
    return c.json({
      data: rows.map((r) => ({
        uuid: r.user.uuid,
        email: r.user.email,
        username: r.user.username,
        twoFactorEnabled: !!r.user.totp,
        permissions: r.sub.permissions,
      })),
      available: allServerPermissions,
    })
  })
  .post(
    '/:server/users',
    validate('json', z.object({ email: z.email(), permissions: z.array(z.string()).max(100) })),
    async (c) => {
      const a = c.get('access')
      a.require('user.create')
      const { email, permissions } = c.req.valid('json')
      // You can only grant what you have yourself.
      const invalid = permissions.filter((p) => !allServerPermissions.includes(p) || !a.can(p))
      if (invalid.length) throw new HttpError(422, `You cannot grant: ${invalid.join(', ')}`, 'invalid')
      const user = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) })
      if (!user)
        throw new HttpError(
          422,
          'No account exists with this email. Ask them to register first.',
          'invalid',
          { email: 'No account with this email' },
        )
      if (user.id === a.server.ownerId)
        throw new HttpError(422, 'The owner already has full access', 'invalid')
      const exists = await db.query.subusers.findFirst({
        where: and(eq(schema.subusers.serverId, a.server.id), eq(schema.subusers.userId, user.id)),
      })
      if (exists) throw new HttpError(409, 'This user already has access', 'conflict')
      await db.insert(schema.subusers).values({
        serverId: a.server.id,
        userId: user.id,
        permissions: [...new Set([...permissions, 'websocket.connect'])],
      })
      await log(c, a, 'server:subuser.create', { email, permissions })
      return c.json({ ok: true }, 201)
    },
  )
  .put(
    '/:server/users/:uuid',
    validate('json', z.object({ permissions: z.array(z.string()).max(100) })),
    async (c) => {
      const a = c.get('access')
      a.require('user.update')
      const user = await db.query.users.findFirst({ where: eq(schema.users.uuid, c.req.param('uuid')) })
      if (!user || user.id === c.get('user')!.id)
        throw new HttpError(422, 'You cannot edit your own permissions', 'invalid')
      const { permissions } = c.req.valid('json')
      const invalid = permissions.filter((p) => !allServerPermissions.includes(p) || !a.can(p))
      if (invalid.length) throw new HttpError(422, `You cannot grant: ${invalid.join(', ')}`, 'invalid')
      const res = await db
        .update(schema.subusers)
        .set({ permissions: [...new Set([...permissions, 'websocket.connect'])] })
        .where(and(eq(schema.subusers.serverId, a.server.id), eq(schema.subusers.userId, user.id)))
        .returning()
      if (!res.length) throw notFound('Subuser')
      await log(c, a, 'server:subuser.update', { email: user.email, permissions })
      return c.json({ ok: true })
    },
  )
  .delete('/:server/users/:uuid', async (c) => {
    const a = c.get('access')
    a.require('user.delete')
    const user = await db.query.users.findFirst({ where: eq(schema.users.uuid, c.req.param('uuid')) })
    if (!user) throw notFound('Subuser')
    await db
      .delete(schema.subusers)
      .where(and(eq(schema.subusers.serverId, a.server.id), eq(schema.subusers.userId, user.id)))
    await log(c, a, 'server:subuser.delete', { email: user.email })
    return c.body(null, 204)
  })

  // ── Schedules ────────────────────────────────────────────
  .get('/:server/schedules', async (c) => {
    const a = c.get('access')
    a.require('schedule.read')
    const schedules = await db.query.schedules.findMany({
      where: eq(schema.schedules.serverId, a.server.id),
      orderBy: asc(schema.schedules.id),
    })
    const tasks = schedules.length
      ? await db.query.scheduleTasks.findMany({
          where: inArray(
            schema.scheduleTasks.scheduleId,
            schedules.map((s) => s.id),
          ),
          orderBy: asc(schema.scheduleTasks.sequence),
        })
      : []
    return c.json({
      data: schedules.map((s) => ({ ...s, tasks: tasks.filter((t) => t.scheduleId === s.id) })),
    })
  })
  .post('/:server/schedules', validate('json', scheduleBody), async (c) => {
    const a = c.get('access')
    a.require('schedule.create')
    const body = c.req.valid('json')
    const [row] = await db
      .insert(schema.schedules)
      .values({ ...body, serverId: a.server.id, nextRunAt: nextRun(body) })
      .returning()
    await log(c, a, 'server:schedule.create', { name: body.name })
    return c.json({ data: row }, 201)
  })
  .put('/:server/schedules/:id', validate('json', scheduleBody), async (c) => {
    const a = c.get('access')
    a.require('schedule.update')
    const body = c.req.valid('json')
    const res = await db
      .update(schema.schedules)
      .set({ ...body, nextRunAt: nextRun(body) })
      .where(
        and(eq(schema.schedules.id, intId(c.req.param('id'))), eq(schema.schedules.serverId, a.server.id)),
      )
      .returning()
    if (!res.length) throw notFound('Schedule')
    return c.json({ data: res[0] })
  })
  .delete('/:server/schedules/:id', async (c) => {
    const a = c.get('access')
    a.require('schedule.delete')
    await db
      .delete(schema.schedules)
      .where(
        and(eq(schema.schedules.id, intId(c.req.param('id'))), eq(schema.schedules.serverId, a.server.id)),
      )
    return c.body(null, 204)
  })
  .post('/:server/schedules/:id/execute', async (c) => {
    const a = c.get('access')
    a.require('schedule.update')
    a.requireReady()
    const s = await db.query.schedules.findFirst({
      where: and(
        eq(schema.schedules.id, intId(c.req.param('id'))),
        eq(schema.schedules.serverId, a.server.id),
      ),
    })
    if (!s) throw notFound('Schedule')
    void runSchedule(s.id, true)
    return c.body(null, 202)
  })
  .post('/:server/schedules/:id/tasks', validate('json', taskBody), async (c) => {
    const a = c.get('access')
    a.require('schedule.update')
    const s = await db.query.schedules.findFirst({
      where: and(
        eq(schema.schedules.id, intId(c.req.param('id'))),
        eq(schema.schedules.serverId, a.server.id),
      ),
    })
    if (!s) throw notFound('Schedule')
    const body = c.req.valid('json')
    if (body.action === 'power' && !['start', 'stop', 'restart', 'kill'].includes(body.payload))
      throw new HttpError(422, 'Power action must be start, stop, restart or kill', 'invalid')
    if (body.action === 'backup' && a.server.backupLimit === 0)
      throw new HttpError(422, 'Backups are not available for this server', 'invalid')
    const [{ n }] = (await db
      .select({ n: count() })
      .from(schema.scheduleTasks)
      .where(eq(schema.scheduleTasks.scheduleId, s.id))) as [{ n: number }]
    if (n >= 10) throw new HttpError(422, 'A schedule can have at most 10 tasks', 'limit')
    const [row] = await db
      .insert(schema.scheduleTasks)
      .values({ ...body, scheduleId: s.id, sequence: n + 1 })
      .returning()
    return c.json({ data: row }, 201)
  })
  .delete('/:server/schedules/:id/tasks/:task', async (c) => {
    const a = c.get('access')
    a.require('schedule.update')
    const s = await db.query.schedules.findFirst({
      where: and(
        eq(schema.schedules.id, intId(c.req.param('id'))),
        eq(schema.schedules.serverId, a.server.id),
      ),
    })
    if (!s) throw notFound('Schedule')
    await db
      .delete(schema.scheduleTasks)
      .where(
        and(
          eq(schema.scheduleTasks.id, intId(c.req.param('task'))),
          eq(schema.scheduleTasks.scheduleId, s.id),
        ),
      )
    // Keep sequence numbers contiguous.
    const rest = await db.query.scheduleTasks.findMany({
      where: eq(schema.scheduleTasks.scheduleId, s.id),
      orderBy: asc(schema.scheduleTasks.sequence),
    })
    for (const [i, t] of rest.entries())
      await db
        .update(schema.scheduleTasks)
        .set({ sequence: i + 1 })
        .where(eq(schema.scheduleTasks.id, t.id))
    return c.body(null, 204)
  })

  // ── Databases ────────────────────────────────────────────
  .get('/:server/databases', async (c) => {
    const a = c.get('access')
    a.require('database.read')
    const rows = await db.query.serverDatabases.findMany({
      where: eq(schema.serverDatabases.serverId, a.server.id),
      orderBy: asc(schema.serverDatabases.id),
    })
    const hosts = await db.query.databaseHosts.findMany()
    return c.json({
      data: rows.map((r) =>
        serializeDatabase(
          r,
          hosts.find((h) => h.id === r.databaseHostId),
          a.can('database.view_password'),
        ),
      ),
      limit: a.server.databaseLimit,
    })
  })
  .post(
    '/:server/databases',
    validate(
      'json',
      z.object({
        name: z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only'),
        remote: z
          .string()
          .max(191)
          .regex(/^[0-9a-zA-Z.%:_-]+$/)
          .default('%'),
      }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('database.create')
      const { name, remote } = c.req.valid('json')
      const row = await createDatabase(a.server, name.toLowerCase(), remote)
      await log(c, a, 'server:database.create', { name: row.database })
      return c.json({ data: { id: row.id } }, 201)
    },
  )
  .post('/:server/databases/:id/rotate-password', async (c) => {
    const a = c.get('access')
    a.require('database.update')
    const row = await db.query.serverDatabases.findFirst({
      where: and(
        eq(schema.serverDatabases.id, intId(c.req.param('id'))),
        eq(schema.serverDatabases.serverId, a.server.id),
      ),
    })
    if (!row) throw notFound('Database')
    await rotatePassword(row)
    await log(c, a, 'server:database.rotate-password', { name: row.database })
    return c.json({ ok: true })
  })
  .delete('/:server/databases/:id', async (c) => {
    const a = c.get('access')
    a.require('database.delete')
    const row = await db.query.serverDatabases.findFirst({
      where: and(
        eq(schema.serverDatabases.id, intId(c.req.param('id'))),
        eq(schema.serverDatabases.serverId, a.server.id),
      ),
    })
    if (!row) throw notFound('Database')
    await deleteDatabase(row)
    await log(c, a, 'server:database.delete', { name: row.database })
    return c.body(null, 204)
  })

  // ── Activity ─────────────────────────────────────────────
  .get('/:server/activity', async (c) => {
    const a = c.get('access')
    a.require('activity.read')
    const rows = await db
      .select({
        log: schema.activityLogs,
        actor: { username: schema.users.username, email: schema.users.email },
      })
      .from(schema.activityLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.activityLogs.actorId))
      .where(
        and(eq(schema.activityLogs.subjectType, 'server'), eq(schema.activityLogs.subjectId, a.server.id)),
      )
      .orderBy(desc(schema.activityLogs.id))
      .limit(100)
    return c.json({ data: rows.map((r) => ({ ...r.log, actor: r.actor })) })
  })
