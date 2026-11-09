import { desc, eq, ilike, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { notFound } from '../../../lib/errors'
import { daemonRequest } from '../../../services/daemon'
import { createServer, deleteServer, setServerSuspended } from '../../../services/servers'
import { clientIp, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { validate } from '../../validate'

const createBody = z.object({
  name: z.string().min(1).max(191),
  description: z.string().nullish(),
  ownerId: z.number().int(),
  eggId: z.number().int(),
  nodeId: z.number().int(),
  allocationId: z.number().int(),
  additionalAllocationIds: z.array(z.number().int()).optional(),
  memory: z.number().int().min(0),
  swap: z.number().int().min(-1).optional(),
  disk: z.number().int().min(0),
  io: z.number().int().min(10).max(1000).optional(),
  cpu: z.number().int().min(0).optional(),
  threads: z
    .string()
    .regex(/^[0-9,-]*$/)
    .nullish(),
  oomDisabled: z.boolean().optional(),
  image: z.string().max(191).optional(),
  startup: z.string().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  databaseLimit: z.number().int().min(0).optional(),
  allocationLimit: z.number().int().min(0).optional(),
  backupLimit: z.number().int().min(0).optional(),
  skipScripts: z.boolean().optional(),
  startOnCompletion: z.boolean().optional(),
  externalId: z.string().max(191).nullish(),
})

const sid = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n)) throw notFound('Server')
  return n
}

async function load(id: number) {
  const server = await db.query.servers.findFirst({ where: eq(schema.servers.id, id) })
  if (!server) throw notFound('Server')
  const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) })
  return { server, node: node! }
}

export const adminServerRoutes = new Hono<AppEnv>()
  .get('/servers', requirePermission('admin.servers.view'), async (c) => {
    const q = c.req.query('q')?.trim()
    const rows = await db
      .select({
        server: schema.servers,
        owner: { id: schema.users.id, email: schema.users.email, username: schema.users.username },
        node: schema.nodes.name,
        egg: schema.eggs.name,
      })
      .from(schema.servers)
      .innerJoin(schema.users, eq(schema.users.id, schema.servers.ownerId))
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.servers.nodeId))
      .innerJoin(schema.eggs, eq(schema.eggs.id, schema.servers.eggId))
      .where(
        q
          ? or(
              ilike(schema.servers.name, `%${q}%`),
              ilike(schema.servers.uuidShort, `%${q}%`),
              ilike(schema.users.email, `%${q}%`),
            )
          : undefined,
      )
      .orderBy(desc(schema.servers.id))
      .limit(200)
    return c.json({
      data: rows.map((r) => ({ ...r.server, owner: r.owner, nodeName: r.node, eggName: r.egg })),
    })
  })
  .post('/servers', requirePermission('admin.servers.manage'), validate('json', createBody), async (c) => {
    const server = await createServer(c.req.valid('json'))
    await logActivity({
      event: 'admin:server.create',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      subject: { type: 'server', id: server.id },
    })
    return c.json({ data: server }, 201)
  })
  .post('/servers/:id/reinstall', requirePermission('admin.servers.manage'), async (c) => {
    const { server, node } = await load(sid(c.req.param('id')))
    await db.update(schema.servers).set({ status: 'installing' }).where(eq(schema.servers.id, server.id))
    await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/reinstall`)
    return c.json({ ok: true })
  })
  .post(
    '/servers/:id/suspend',
    requirePermission('admin.servers.manage'),
    validate('json', z.object({ suspended: z.boolean() })),
    async (c) => {
      const { server } = await load(sid(c.req.param('id')))
      const suspended = c.req.valid('json').suspended
      await setServerSuspended(server.id, suspended)
      await logActivity({
        event: suspended ? 'admin:server.suspend' : 'admin:server.unsuspend',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'server', id: server.id },
      })
      return c.json({ ok: true })
    },
  )
  .delete('/servers/:id', requirePermission('admin.servers.manage'), async (c) => {
    const force = c.req.query('force') === '1'
    const server = await deleteServer(sid(c.req.param('id')), force)
    await logActivity({
      event: 'admin:server.delete',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      properties: { uuid: server.uuid, name: server.name },
    })
    return c.json({ ok: true })
  })
  // Generated daemon configuration for a node
  .get('/nodes/:id/configuration', requirePermission('admin.nodes.manage'), async (c) => {
    const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, sid(c.req.param('id'))) })
    if (!node) throw notFound('Node')
    const { decrypt } = await import('../../../lib/crypto')
    const { config } = await import('../../../config')
    const token = decrypt(node.token)
    return c.json({
      command: `ammonode-daemon configure --panel ${config.url} --uuid ${node.uuid} --token-id ${node.tokenId} --token ${token} --port ${node.daemonListen} --sftp-port ${node.daemonSftp}`,
    })
  })
