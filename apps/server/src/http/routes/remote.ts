import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { db, schema } from '../../db'
import { logActivity } from '../../lib/activity'
import { decrypt, safeEqual } from '../../lib/crypto'
import { HttpError, notFound } from '../../lib/errors'
import { buildServerConfiguration, installScript } from '../../services/server-config'
import { validate } from '../validate'

type Node = typeof schema.nodes.$inferSelect
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
