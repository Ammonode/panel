import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { encrypt, randomString } from '../../../lib/crypto'
import { HttpError, notFound } from '../../../lib/errors'
import { testHost } from '../../../services/databases'
import { fetchCatalogEgg, getEggCatalog } from '../../../services/egg-catalog'
import { exportEgg, importEgg } from '../../../services/eggs'
import { clientIp, newIdentifier, newUuid, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { onlyProvided, validate } from '../../validate'

const id = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}

const locationBody = z.object({ short: z.string().min(1).max(60), long: z.string().max(191).nullish() })

const nodeBody = z.object({
  name: z.string().min(1).max(191),
  description: z.string().nullish(),
  locationId: z.number().int(),
  fqdn: z
    .string()
    .min(1)
    .max(191)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Use a domain name or an IPv4 address'),
  scheme: z.enum(['http', 'https']).default('https'),
  behindProxy: z.boolean().default(false),
  public: z.boolean().default(true),
  maintenance: z.boolean().default(false),
  memory: z.number().int().min(0),
  memoryOverallocate: z.number().int().min(-1).default(0),
  disk: z.number().int().min(0),
  diskOverallocate: z.number().int().min(-1).default(0),
  uploadSize: z.number().int().min(1).max(10240).default(100),
  daemonListen: z.number().int().min(1).max(65535).default(8080),
  daemonSftp: z.number().int().min(1).max(65535).default(2022),
  daemonBase: z.string().default('/var/lib/ammonode/volumes'),
})

export const adminPanelRoutes = new Hono<AppEnv>()
  // ── Locations ─────────────────────────────────────────────
  .get('/locations', requirePermission('admin.locations.manage'), async (c) => {
    const rows = await db
      .select({ location: schema.locations, nodes: count(schema.nodes.id) })
      .from(schema.locations)
      .leftJoin(schema.nodes, eq(schema.nodes.locationId, schema.locations.id))
      .groupBy(schema.locations.id)
      .orderBy(asc(schema.locations.short))
    return c.json({ data: rows.map((r) => ({ ...r.location, nodeCount: r.nodes })) })
  })
  .post(
    '/locations',
    requirePermission('admin.locations.manage'),
    validate('json', locationBody),
    async (c) => {
      const [row] = await db.insert(schema.locations).values(c.req.valid('json')).returning()
      return c.json({ data: row }, 201)
    },
  )
  .patch(
    '/locations/:id',
    requirePermission('admin.locations.manage'),
    validate('json', locationBody.partial()),
    async (c) => {
      const [row] = await db
        .update(schema.locations)
        .set(await onlyProvided(c, c.req.valid('json')))
        .where(eq(schema.locations.id, id(c.req.param('id'))))
        .returning()
      if (!row) throw notFound('Location')
      return c.json({ data: row })
    },
  )
  .delete('/locations/:id', requirePermission('admin.locations.manage'), async (c) => {
    const lid = id(c.req.param('id'))
    const [used] = await db.select({ n: count() }).from(schema.nodes).where(eq(schema.nodes.locationId, lid))
    if (used!.n > 0) throw new HttpError(409, 'Cannot delete a location that still has nodes', 'in_use')
    await db.delete(schema.locations).where(eq(schema.locations.id, lid))
    return c.json({ ok: true })
  })

  // ── Nodes ─────────────────────────────────────────────────
  .get('/nodes', requirePermission('admin.nodes.manage'), async (c) => {
    const rows = await db.query.nodes.findMany({ orderBy: asc(schema.nodes.id), columns: { token: false } })
    return c.json({ data: rows })
  })
  .get('/nodes/:id', requirePermission('admin.nodes.manage'), async (c) => {
    const node = await db.query.nodes.findFirst({
      where: eq(schema.nodes.id, id(c.req.param('id'))),
      columns: { token: false },
    })
    if (!node) throw notFound('Node')
    return c.json({ data: node })
  })
  .post('/nodes', requirePermission('admin.nodes.manage'), validate('json', nodeBody), async (c) => {
    const [row] = await db
      .insert(schema.nodes)
      .values({
        ...c.req.valid('json'),
        uuid: newUuid(),
        tokenId: newIdentifier(),
        token: encrypt(randomString(64)),
      })
      .returning()
    await logActivity({
      event: 'admin:node.create',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      subject: { type: 'node', id: row!.id },
    })
    const { token: _, ...node } = row!
    return c.json({ data: node }, 201)
  })
  .patch(
    '/nodes/:id',
    requirePermission('admin.nodes.manage'),
    validate('json', nodeBody.partial()),
    async (c) => {
      const [row] = await db
        .update(schema.nodes)
        .set(await onlyProvided(c, c.req.valid('json')))
        .where(eq(schema.nodes.id, id(c.req.param('id'))))
        .returning()
      if (!row) throw notFound('Node')
      const { token: _, ...node } = row
      return c.json({ data: node })
    },
  )
  .post('/nodes/:id/reset-token', requirePermission('admin.nodes.manage'), async (c) => {
    await db
      .update(schema.nodes)
      .set({ tokenId: newIdentifier(), token: encrypt(randomString(64)) })
      .where(eq(schema.nodes.id, id(c.req.param('id'))))
    return c.json({ ok: true })
  })
  .delete('/nodes/:id', requirePermission('admin.nodes.manage'), async (c) => {
    const nid = id(c.req.param('id'))
    const [used] = await db.select({ n: count() }).from(schema.servers).where(eq(schema.servers.nodeId, nid))
    if (used!.n > 0) throw new HttpError(409, 'Cannot delete a node that still has servers', 'in_use')
    await db.delete(schema.nodes).where(eq(schema.nodes.id, nid))
    return c.json({ ok: true })
  })

  // ── Allocations ───────────────────────────────────────────
  .get('/nodes/:id/allocations', requirePermission('admin.nodes.manage'), async (c) => {
    const rows = await db.query.allocations.findMany({
      where: eq(schema.allocations.nodeId, id(c.req.param('id'))),
      orderBy: [asc(schema.allocations.ip), asc(schema.allocations.port)],
    })
    return c.json({ data: rows })
  })
  .post(
    '/nodes/:id/allocations',
    requirePermission('admin.nodes.manage'),
    validate(
      'json',
      z.object({
        ip: z.union([z.ipv4(), z.ipv6()]),
        alias: z.string().max(191).nullish(),
        // e.g. ["25565", "25570-25580"]
        ports: z.array(z.string().regex(/^\d{1,5}(-\d{1,5})?$/)).min(1),
      }),
    ),
    async (c) => {
      const nodeId = id(c.req.param('id'))
      const { ip, alias, ports } = c.req.valid('json')
      const list = new Set<number>()
      for (const p of ports) {
        const [a, b = a] = p.split('-').map(Number) as [number, number?]
        if (a! < 1024 || b! > 65535 || b! < a!)
          throw new HttpError(422, `Invalid port range ${p} (1024-65535)`, 'invalid')
        if (b! - a! > 1000) throw new HttpError(422, 'A single range may not exceed 1000 ports', 'invalid')
        for (let i = a!; i <= b!; i++) list.add(i)
      }
      const rows = await db
        .insert(schema.allocations)
        .values([...list].map((port) => ({ nodeId, ip, ipAlias: alias ?? null, port })))
        .onConflictDoNothing()
        .returning()
      return c.json({ data: rows, created: rows.length }, 201)
    },
  )
  .delete(
    '/nodes/:id/allocations',
    requirePermission('admin.nodes.manage'),
    validate('json', z.object({ ids: z.array(z.number().int()) })),
    async (c) => {
      await db
        .delete(schema.allocations)
        .where(
          and(
            eq(schema.allocations.nodeId, id(c.req.param('id'))),
            inArray(schema.allocations.id, c.req.valid('json').ids),
            isNull(schema.allocations.serverId),
          ),
        )
      return c.json({ ok: true })
    },
  )

  // ── Nests & eggs ──────────────────────────────────────────
  .get('/nests', requirePermission('admin.nests.manage'), async (c) => {
    const nests = await db.query.nests.findMany({ orderBy: asc(schema.nests.id) })
    const eggs = await db
      .select({
        id: schema.eggs.id,
        nestId: schema.eggs.nestId,
        name: schema.eggs.name,
        description: schema.eggs.description,
        author: schema.eggs.author,
        sourceUrl: schema.eggs.sourceUrl,
      })
      .from(schema.eggs)
      .orderBy(asc(schema.eggs.name))
    return c.json({ data: nests.map((n) => ({ ...n, eggs: eggs.filter((e) => e.nestId === n.id) })) })
  })
  .post(
    '/nests',
    requirePermission('admin.nests.manage'),
    validate('json', z.object({ name: z.string().min(1).max(191), description: z.string().nullish() })),
    async (c) => {
      const [row] = await db
        .insert(schema.nests)
        .values({ ...c.req.valid('json'), uuid: newUuid(), author: c.get('user')!.email })
        .returning()
      return c.json({ data: row }, 201)
    },
  )
  .delete('/nests/:id', requirePermission('admin.nests.manage'), async (c) => {
    const nid = id(c.req.param('id'))
    const [used] = await db.select({ n: count() }).from(schema.servers).where(eq(schema.servers.nestId, nid))
    if (used!.n > 0) throw new HttpError(409, 'Cannot delete a nest that still has servers', 'in_use')
    await db.delete(schema.nests).where(eq(schema.nests.id, nid))
    return c.json({ ok: true })
  })
  .get('/eggs/:id', requirePermission('admin.nests.manage'), async (c) => {
    const eid = id(c.req.param('id'))
    const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, eid) })
    if (!egg) throw notFound('Egg')
    const variables = await db.query.eggVariables.findMany({
      where: eq(schema.eggVariables.eggId, eid),
      orderBy: asc(schema.eggVariables.sort),
    })
    return c.json({ data: { ...egg, variables } })
  })
  .get('/eggs/:id/export', requirePermission('admin.nests.manage'), async (c) => {
    const data = await exportEgg(id(c.req.param('id')))
    const name = `egg-${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
    c.header('content-disposition', `attachment; filename="${name}"`)
    return c.json(data)
  })
  .post(
    '/nests/:id/import',
    requirePermission('admin.nests.manage'),
    validate(
      'json',
      z.object({
        egg: z.unknown().optional(),
        url: z.url().optional(),
        updateEggId: z.number().int().optional(),
      }),
    ),
    async (c) => {
      const nestId = id(c.req.param('id'))
      const body = c.req.valid('json')
      let payload = body.egg
      if (body.url) {
        try {
          payload = await fetchCatalogEgg(body.url)
        } catch (e) {
          throw new HttpError(422, (e as Error).message, 'fetch_failed')
        }
      }
      if (!payload) throw new HttpError(422, 'Provide an egg file or a catalog URL', 'invalid')
      const eggId = await importEgg(nestId, payload, { updateEggId: body.updateEggId, sourceUrl: body.url })
      await logActivity({
        event: 'admin:egg.import',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'egg', id: eggId },
      })
      return c.json({ data: { id: eggId } }, 201)
    },
  )
  .delete('/eggs/:id', requirePermission('admin.nests.manage'), async (c) => {
    const eid = id(c.req.param('id'))
    const [used] = await db.select({ n: count() }).from(schema.servers).where(eq(schema.servers.eggId, eid))
    if (used!.n > 0) throw new HttpError(409, 'Cannot delete an egg that still has servers', 'in_use')
    await db.delete(schema.eggs).where(eq(schema.eggs.id, eid))
    return c.json({ ok: true })
  })
  // Official egg catalog (eggs.pterodactyl.io)
  .get('/egg-catalog', requirePermission('admin.nests.manage'), async (c) => {
    const eggs = await getEggCatalog(c.req.query('refresh') === '1')
    const imported = await db.select({ url: schema.eggs.sourceUrl, id: schema.eggs.id }).from(schema.eggs)
    const map = new Map(imported.filter((e) => e.url).map((e) => [e.url, e.id]))
    return c.json({ data: eggs.map((e) => ({ ...e, importedEggId: map.get(e.rawUrl) ?? null })) })
  })

const dbHostBody = z.object({
  name: z.string().min(1).max(191),
  host: z.string().min(1).max(191),
  port: z.number().int().min(1).max(65535).default(3306),
  username: z.string().min(1).max(191),
  password: z.string().min(1).max(512),
  maxDatabases: z.number().int().min(1).nullish(),
  nodeId: z.number().int().nullish(),
})

export const adminDatabaseHostRoutes = new Hono<AppEnv>()
  .get('/database-hosts', requirePermission('admin.databases.manage'), async (c) => {
    const hosts = await db.query.databaseHosts.findMany({ orderBy: asc(schema.databaseHosts.id) })
    const usage = await db
      .select({ hostId: schema.serverDatabases.databaseHostId, n: count() })
      .from(schema.serverDatabases)
      .groupBy(schema.serverDatabases.databaseHostId)
    return c.json({
      data: hosts.map(({ password: _, ...h }) => ({
        ...h,
        databases: usage.find((u) => u.hostId === h.id)?.n ?? 0,
      })),
    })
  })
  .post(
    '/database-hosts',
    requirePermission('admin.databases.manage'),
    validate('json', dbHostBody),
    async (c) => {
      const body = c.req.valid('json')
      await testHost(body)
      const [row] = await db
        .insert(schema.databaseHosts)
        .values({ ...body, password: encrypt(body.password) })
        .returning()
      const { password: _, ...host } = row!
      return c.json({ data: host }, 201)
    },
  )
  .delete('/database-hosts/:id', requirePermission('admin.databases.manage'), async (c) => {
    const hid = id(c.req.param('id'))
    const [used] = await db
      .select({ n: count() })
      .from(schema.serverDatabases)
      .where(eq(schema.serverDatabases.databaseHostId, hid))
    if (used!.n > 0) throw new HttpError(409, 'This host still has databases', 'in_use')
    await db.delete(schema.databaseHosts).where(eq(schema.databaseHosts.id, hid))
    return c.json({ ok: true })
  })
