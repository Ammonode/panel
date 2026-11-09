import { and, asc, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { HttpError } from '../../lib/errors'
import { expandPermissions, type ServerAccess, serverAccess } from '../../services/access'
import { daemonRequest, signDaemonToken } from '../../services/daemon'
import { validateVariable } from '../../services/servers'
import { clientIp, requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'
import { validate } from '../validate'

export type Env = AppEnv & { Variables: { access: ServerAccess } }

export const daemonBase = (a: ServerAccess) => `/api/servers/${a.server.uuid}`
const socketUrl = (a: ServerAccess) =>
  `${a.node.scheme === 'https' ? 'wss' : 'ws'}://${a.node.fqdn}:${a.node.daemonListen}/api/servers/${a.server.uuid}/ws`

/** Normalises a client supplied path to `/a/b` form. */
export const cleanPath = (p: string | undefined) =>
  `/${(p ?? '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')}`

export const log = (
  c: Context<Env>,
  a: ServerAccess,
  event: string,
  properties: Record<string, unknown> = {},
) =>
  logActivity({
    event,
    actorId: c.get('user')!.id,
    ip: clientIp(c),
    subject: { type: 'server', id: a.server.id },
    properties,
  })

export const clientServerRoutes = new Hono<Env>()
  .use(requireAuth)
  .use('/:server/*', async (c, next) => {
    c.set('access', await serverAccess(c.get('user')!, c.get('permissions'), c.req.param('server')!))
    await next()
  })

  .get('/:server', async (c) => {
    const a = c.get('access')
    const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, a.server.eggId) })
    const allocation = await db.query.allocations.findFirst({
      where: eq(schema.allocations.id, a.server.allocationId),
    })
    const s = a.server
    return c.json({
      data: {
        id: s.id,
        uuid: s.uuid,
        identifier: s.uuidShort,
        name: s.name,
        description: s.description,
        status: s.status,
        isOwner: a.isOwner,
        node: a.node.name,
        sftp: {
          host: a.node.fqdn,
          port: a.node.daemonSftp,
          username: `${c.get('user')!.username}.${s.uuidShort}`,
        },
        limits: { memory: s.memory, swap: s.swap, disk: s.disk, io: s.io, cpu: s.cpu },
        featureLimits: { databases: s.databaseLimit, allocations: s.allocationLimit, backups: s.backupLimit },
        allocation: allocation ? { ip: allocation.ipAlias ?? allocation.ip, port: allocation.port } : null,
        egg: egg ? { name: egg.name, features: egg.features, dockerImages: egg.dockerImages } : null,
        image: s.image,
        invocation: s.startup,
        permissions: expandPermissions(a.permissions),
      },
    })
  })

  .get('/:server/websocket', async (c) => {
    const a = c.get('access')
    a.require('websocket.connect')
    const perms = a.permissions.includes('*') ? ['*'] : a.permissions
    const token = await signDaemonToken(
      a.node,
      { server_uuid: a.server.uuid, user_uuid: c.get('user')!.uuid, permissions: perms },
      600,
    )
    return c.json({ data: { token, socket: socketUrl(a) } })
  })

  .get('/:server/resources', async (c) => {
    const a = c.get('access')
    const res = await daemonRequest<{
      state: string
      is_installing: boolean
      utilization: Record<string, unknown>
    }>(a.node, 'GET', daemonBase(a)).catch(() => null)
    return c.json({
      data: res ?? { state: 'offline', is_installing: false, utilization: null, unreachable: true },
    })
  })

  .post(
    '/:server/power',
    validate('json', z.object({ signal: z.enum(['start', 'stop', 'restart', 'kill']) })),
    async (c) => {
      const a = c.get('access')
      const { signal } = c.req.valid('json')
      a.require(signal === 'kill' ? 'control.stop' : `control.${signal}`)
      a.requireReady()
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/power`, { action: signal })
      await log(c, a, `server:power.${signal}`)
      return c.body(null, 204)
    },
  )

  .post(
    '/:server/command',
    validate('json', z.object({ command: z.string().min(1).max(4096) })),
    async (c) => {
      const a = c.get('access')
      a.require('control.console')
      a.requireReady()
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/commands`, {
        commands: [c.req.valid('json').command],
      })
      await log(c, a, 'server:console.command', { command: c.req.valid('json').command })
      return c.body(null, 204)
    },
  )

  // ── Files ────────────────────────────────────────────────
  .get('/:server/files/list', async (c) => {
    const a = c.get('access')
    a.require('file.read')
    a.requireReady()
    const dir = cleanPath(c.req.query('directory'))
    const data = await daemonRequest(
      a.node,
      'GET',
      `${daemonBase(a)}/files/list-directory?directory=${encodeURIComponent(dir)}`,
    )
    return c.json({ data })
  })
  .get('/:server/files/contents', async (c) => {
    const a = c.get('access')
    a.require('file.read-content')
    a.requireReady()
    const file = cleanPath(c.req.query('file'))
    const text = await daemonRequest<string>(
      a.node,
      'GET',
      `${daemonBase(a)}/files/contents?file=${encodeURIComponent(file)}`,
    )
    return c.text(typeof text === 'string' ? text : JSON.stringify(text, null, 2))
  })
  .post('/:server/files/write', async (c) => {
    const a = c.get('access')
    a.require('file.update')
    a.requireReady()
    const file = cleanPath(c.req.query('file'))
    await daemonRequest(
      a.node,
      'POST',
      `${daemonBase(a)}/files/write?file=${encodeURIComponent(file)}`,
      await c.req.text(),
    )
    await log(c, a, 'server:file.write', { file })
    return c.body(null, 204)
  })
  .put(
    '/:server/files/rename',
    validate(
      'json',
      z.object({
        root: z.string().default('/'),
        files: z.array(z.object({ from: z.string(), to: z.string() })).min(1),
      }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('file.update')
      a.requireReady()
      const body = c.req.valid('json')
      await daemonRequest(a.node, 'PUT', `${daemonBase(a)}/files/rename`, {
        ...body,
        root: cleanPath(body.root),
      })
      await log(c, a, 'server:file.rename', body)
      return c.body(null, 204)
    },
  )
  .post(
    '/:server/files/create-folder',
    validate('json', z.object({ root: z.string().default('/'), name: z.string().min(1).max(255) })),
    async (c) => {
      const a = c.get('access')
      a.require('file.create')
      a.requireReady()
      const { root, name } = c.req.valid('json')
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/create-directory`, {
        path: cleanPath(root),
        name,
      })
      return c.body(null, 204)
    },
  )
  .post(
    '/:server/files/delete',
    validate('json', z.object({ root: z.string().default('/'), files: z.array(z.string()).min(1) })),
    async (c) => {
      const a = c.get('access')
      a.require('file.delete')
      a.requireReady()
      const { root, files } = c.req.valid('json')
      await daemonRequest(a.node, 'POST', `${daemonBase(a)}/files/delete`, { root: cleanPath(root), files })
      await log(c, a, 'server:file.delete', { root, files })
      return c.body(null, 204)
    },
  )
  .get('/:server/files/download', async (c) => {
    const a = c.get('access')
    a.require('file.read-content')
    a.requireReady()
    const file = cleanPath(c.req.query('file'))
    const token = await signDaemonToken(a.node, { server_uuid: a.server.uuid, file_path: file }, 300)
    await log(c, a, 'server:file.download', { file })
    return c.json({
      data: { url: `${a.node.scheme}://${a.node.fqdn}:${a.node.daemonListen}/download/file?token=${token}` },
    })
  })

  // ── Startup ──────────────────────────────────────────────
  .get('/:server/startup', async (c) => {
    const a = c.get('access')
    a.require('startup.read')
    const vars = await db.query.eggVariables.findMany({
      where: and(eq(schema.eggVariables.eggId, a.server.eggId), eq(schema.eggVariables.userViewable, true)),
      orderBy: asc(schema.eggVariables.sort),
    })
    const values = await db.query.serverVariables.findMany({
      where: eq(schema.serverVariables.serverId, a.server.id),
    })
    const data = vars.map((v) => ({
      name: v.name,
      description: v.description,
      envVariable: v.envVariable,
      defaultValue: v.defaultValue,
      serverValue: values.find((x) => x.variableId === v.id)?.value ?? v.defaultValue,
      isEditable: v.userEditable,
      rules: v.rules,
    }))
    const env = Object.fromEntries(data.map((d) => [d.envVariable, d.serverValue]))
    const display = a.server.startup.replace(
      /{{\s*(\w+)\s*}}/g,
      (m, k: string) => env[k] ?? (k === 'SERVER_MEMORY' ? String(a.server.memory) : m),
    )
    return c.json({ data, startup: display })
  })
  .put(
    '/:server/startup/variable',
    validate('json', z.object({ key: z.string(), value: z.string().max(4096) })),
    async (c) => {
      const a = c.get('access')
      a.require('startup.update')
      const { key, value } = c.req.valid('json')
      const variable = await db.query.eggVariables.findFirst({
        where: and(eq(schema.eggVariables.eggId, a.server.eggId), eq(schema.eggVariables.envVariable, key)),
      })
      if (!variable?.userViewable || !variable.userEditable)
        throw new HttpError(422, 'This variable cannot be edited', 'invalid')
      const err = validateVariable(variable.rules, value)
      if (err)
        throw new HttpError(422, `${variable.name} ${err}`, 'invalid', { value: `${variable.name} ${err}` })
      await db
        .insert(schema.serverVariables)
        .values({ serverId: a.server.id, variableId: variable.id, value })
        .onConflictDoUpdate({
          target: [schema.serverVariables.serverId, schema.serverVariables.variableId],
          set: { value },
        })
      await log(c, a, 'server:startup.edit', { variable: key, value })
      return c.json({ ok: true })
    },
  )
  .put('/:server/settings/docker-image', validate('json', z.object({ image: z.string() })), async (c) => {
    const a = c.get('access')
    a.require('startup.docker-image')
    const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, a.server.eggId) })
    const { image } = c.req.valid('json')
    if (!Object.values(egg?.dockerImages ?? {}).includes(image))
      throw new HttpError(422, 'This image is not offered by the egg', 'invalid')
    await db.update(schema.servers).set({ image }).where(eq(schema.servers.id, a.server.id))
    await log(c, a, 'server:startup.image', { old: a.server.image, new: image })
    return c.json({ ok: true })
  })

  // ── Settings & network ──────────────────────────────────
  .post(
    '/:server/settings/rename',
    validate(
      'json',
      z.object({ name: z.string().min(1).max(191), description: z.string().max(500).nullish() }),
    ),
    async (c) => {
      const a = c.get('access')
      a.require('settings.rename')
      await db.update(schema.servers).set(c.req.valid('json')).where(eq(schema.servers.id, a.server.id))
      await log(c, a, 'server:settings.rename', { old: a.server.name, new: c.req.valid('json').name })
      return c.json({ ok: true })
    },
  )
  .post('/:server/settings/reinstall', async (c) => {
    const a = c.get('access')
    a.require('settings.reinstall')
    a.requireReady()
    await db.update(schema.servers).set({ status: 'installing' }).where(eq(schema.servers.id, a.server.id))
    await daemonRequest(a.node, 'POST', `${daemonBase(a)}/reinstall`)
    await log(c, a, 'server:reinstall')
    return c.json({ ok: true })
  })
  .get('/:server/network/allocations', async (c) => {
    const a = c.get('access')
    a.require('allocation.read')
    const rows = await db.query.allocations.findMany({
      where: eq(schema.allocations.serverId, a.server.id),
      orderBy: asc(schema.allocations.port),
    })
    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        ip: r.ipAlias ?? r.ip,
        port: r.port,
        notes: r.notes,
        isDefault: r.id === a.server.allocationId,
      })),
      limit: a.server.allocationLimit,
    })
  })
