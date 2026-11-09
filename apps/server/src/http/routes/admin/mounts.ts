import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { HttpError, notFound } from '../../../lib/errors'
import { daemonRequest } from '../../../services/daemon'
import { requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { validate } from '../../validate'

// Host paths that must never be mounted into a game server.
const FORBIDDEN = ['/etc', '/root', '/var/lib/docker', '/proc', '/sys', '/dev', '/boot', '/run']
const mountBody = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullish(),
  source: z
    .string()
    .min(2)
    .max(191)
    .regex(/^\/[^\0]*$/, 'Use an absolute path'),
  target: z
    .string()
    .min(2)
    .max(191)
    .regex(/^\/[^\0]*$/, 'Use an absolute path'),
  readOnly: z.boolean().default(false),
  eggIds: z.array(z.number().int()).default([]),
  nodeIds: z.array(z.number().int()).default([]),
})

function checkPaths(source: string, target: string) {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/'
  if (source.includes('..') || target.includes('..'))
    throw new HttpError(422, 'Paths may not contain ..', 'invalid')
  if (FORBIDDEN.some((f) => norm(source) === f || norm(source).startsWith(`${f}/`)) || norm(source) === '/')
    throw new HttpError(422, 'This host path cannot be mounted', 'invalid')
  if (norm(target) === '/home/container' || norm(target).startsWith('/home/container/'))
    throw new HttpError(422, 'The target cannot be inside /home/container', 'invalid')
}

export const adminMountRoutes = new Hono<AppEnv>()
  .get('/mounts', requirePermission('admin.mounts.manage'), async (c) => {
    const rows = await db.query.mounts.findMany()
    const links = await db.query.serverMounts.findMany()
    return c.json({
      data: rows.map((m) => ({
        ...m,
        servers: links.filter((l) => l.mountId === m.id).map((l) => l.serverId),
      })),
    })
  })
  .post('/mounts', requirePermission('admin.mounts.manage'), validate('json', mountBody), async (c) => {
    const v = c.req.valid('json')
    checkPaths(v.source, v.target)
    const [row] = await db
      .insert(schema.mounts)
      .values({ ...v, uuid: crypto.randomUUID() })
      .returning()
    return c.json({ data: row }, 201)
  })
  .delete('/mounts/:id', requirePermission('admin.mounts.manage'), async (c) => {
    await db.delete(schema.mounts).where(eq(schema.mounts.id, Number(c.req.param('id'))))
    return c.json({ ok: true })
  })
  // Attach or detach a mount to a server; applies on the next start.
  .put(
    '/servers/:id/mounts/:mount',
    requirePermission('admin.mounts.manage'),
    validate('json', z.object({ attached: z.boolean() })),
    async (c) => {
      const serverId = Number(c.req.param('id'))
      const mountId = Number(c.req.param('mount'))
      const server = await db.query.servers.findFirst({ where: eq(schema.servers.id, serverId) })
      const mount = await db.query.mounts.findFirst({ where: eq(schema.mounts.id, mountId) })
      if (!server || !mount) throw notFound()
      if (c.req.valid('json').attached) {
        if (mount.eggIds.length && !mount.eggIds.includes(server.eggId))
          throw new HttpError(422, 'This mount is not available for the egg of this server', 'invalid')
        if (mount.nodeIds.length && !mount.nodeIds.includes(server.nodeId))
          throw new HttpError(422, 'This mount is not available on the node of this server', 'invalid')
        await db.insert(schema.serverMounts).values({ serverId, mountId }).onConflictDoNothing()
      } else {
        await db
          .delete(schema.serverMounts)
          .where(and(eq(schema.serverMounts.serverId, serverId), eq(schema.serverMounts.mountId, mountId)))
      }
      const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) })
      if (node) await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/sync`).catch(() => {})
      return c.json({ ok: true })
    },
  )
