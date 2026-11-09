import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { notFound } from '../../../lib/errors'
import { daemonRequest } from '../../../services/daemon'
import { createServer } from '../../../services/servers'
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
  threads: z.string().regex(/^[0-9,-]*$/).nullish(),
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
    const rows = await db.query.servers.findMany({ orderBy: desc(schema.servers.id), limit: 200 })
    return c.json({ data: rows })
  })
  .get('/servers/:id', requirePermission('admin.servers.view'), async (c) => c.json({ data: (await load(sid(c.req.param('id')))).server }))
  .post('/servers', requirePermission('admin.servers.manage'), validate('json', createBody), async (c) => {
    const server = await createServer(c.req.valid('json'))
    await logActivity({ event: 'admin:server.create', actorId: c.get('user')!.id, ip: clientIp(c), subject: { type: 'server', id: server.id } })
    return c.json({ data: server }, 201)
  })
  .post('/servers/:id/reinstall', requirePermission('admin.servers.manage'), async (c) => {
    const { server, node } = await load(sid(c.req.param('id')))
    await db.update(schema.servers).set({ status: 'installing' }).where(eq(schema.servers.id, server.id))
    await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/reinstall`)
    return c.json({ ok: true })
  })
  .post('/servers/:id/suspend', requirePermission('admin.servers.manage'), validate('json', z.object({ suspended: z.boolean() })), async (c) => {
    const { server, node } = await load(sid(c.req.param('id')))
    const suspended = c.req.valid('json').suspended
    await db.update(schema.servers).set({ status: suspended ? 'suspended' : null }).where(eq(schema.servers.id, server.id))
    await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/sync`).catch(() => {})
    return c.json({ ok: true })
  })
  .delete('/servers/:id', requirePermission('admin.servers.manage'), async (c) => {
    const { server, node } = await load(sid(c.req.param('id')))
    const force = c.req.query('force') === '1'
    await daemonRequest(node, 'DELETE', `/api/servers/${server.uuid}`).catch((e) => {
      if (!force) throw e
    })
    await db.transaction(async (tx) => {
      await tx.update(schema.allocations).set({ serverId: null, notes: null }).where(eq(schema.allocations.serverId, server.id))
      await tx.delete(schema.servers).where(eq(schema.servers.id, server.id))
    })
    await logActivity({ event: 'admin:server.delete', actorId: c.get('user')!.id, ip: clientIp(c), properties: { uuid: server.uuid, name: server.name } })
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
