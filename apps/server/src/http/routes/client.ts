import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, schema } from '../../db'
import { daemonRequest } from '../../services/daemon'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

export const clientRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  // Numbers shown on the dashboard overview cards.
  .get('/overview', async (c) => {
    const uid = c.get('user')!.id
    const [servers] = await db
      .select({ n: count() })
      .from(schema.servers)
      .where(eq(schema.servers.ownerId, uid))
    const [services] = await db
      .select({ n: count() })
      .from(schema.services)
      .where(and(eq(schema.services.userId, uid), eq(schema.services.status, 'active')))
    const tickets = await db.query.tickets.findMany({
      where: eq(schema.tickets.userId, uid),
      orderBy: desc(schema.tickets.updatedAt),
      limit: 3,
    })
    const invoices = await db
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        status: schema.invoices.status,
        dueAt: schema.invoices.dueAt,
        currencyCode: schema.invoices.currencyCode,
        total: sql<string>`coalesce(sum(${schema.invoiceItems.price} * ${schema.invoiceItems.quantity}), 0)`,
        description: sql<string | null>`min(${schema.invoiceItems.description})`,
      })
      .from(schema.invoices)
      .leftJoin(schema.invoiceItems, eq(schema.invoiceItems.invoiceId, schema.invoices.id))
      .where(and(eq(schema.invoices.userId, uid), eq(schema.invoices.status, 'pending')))
      .groupBy(schema.invoices.id)
      .orderBy(desc(schema.invoices.dueAt))
      .limit(10)
    // Live usage across the user's own servers, read from the nodes (best effort, 2s budget).
    const owned = await db.query.servers.findMany({ where: eq(schema.servers.ownerId, uid), limit: 25 })
    const nodes = owned.length
      ? await db.query.nodes.findMany({
          where: inArray(schema.nodes.id, [...new Set(owned.map((s) => s.nodeId))]),
        })
      : []
    const live = await Promise.all(
      owned.map(async (s) => {
        const node = nodes.find((n) => n.id === s.nodeId)
        if (!node) return null
        return Promise.race([
          daemonRequest<{ utilization: { memory_bytes: number; disk_bytes: number } }>(
            node,
            'GET',
            `/api/servers/${s.uuid}`,
          ).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ])
      }),
    )
    const mib = 1024 * 1024
    const usage = {
      memory: {
        used: Math.round(live.reduce((t, l) => t + (l?.utilization?.memory_bytes ?? 0), 0) / mib),
        total: owned.reduce((t, s) => t + s.memory, 0),
      },
      disk: {
        used: Math.round(live.reduce((t, l) => t + (l?.utilization?.disk_bytes ?? 0), 0) / mib),
        total: owned.reduce((t, s) => t + s.disk, 0),
      },
    }
    return c.json({
      stats: { servers: servers!.n, services: services!.n, invoicesDue: invoices.length },
      usage,
      tickets,
      invoices,
    })
  })
  .post('/notifications/read', async (c) => {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.userId, c.get('user')!.id), isNull(schema.notifications.readAt)))
    return c.json({ ok: true })
  })
  .get('/notifications', async (c) => {
    const rows = await db.query.notifications.findMany({
      where: eq(schema.notifications.userId, c.get('user')!.id),
      orderBy: desc(schema.notifications.id),
      limit: 20,
    })
    return c.json({ data: rows, unread: rows.filter((r) => !r.readAt).length })
  })
  .get('/servers', async (c) => {
    const uid = c.get('user')!.id
    const sub = db
      .select({ id: schema.subusers.serverId })
      .from(schema.subusers)
      .where(eq(schema.subusers.userId, uid))
    const rows = await db.query.servers.findMany({
      where: or(eq(schema.servers.ownerId, uid), inArray(schema.servers.id, sub)),
      orderBy: desc(schema.servers.id),
    })
    return c.json({ data: rows })
  })
