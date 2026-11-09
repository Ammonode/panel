import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, schema } from '../../db'
import { hasPermission } from '../../lib/permissions'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

type Result = {
  type: 'server' | 'service' | 'invoice' | 'ticket' | 'user'
  title: string
  subtitle?: string
  url: string
}

/** Quick search for the topbar: the user's own things, plus users and all servers for staff. */
export const searchRoutes = new Hono<AppEnv>().use(requireAuth).get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 64)
  if (q.length < 2) return c.json({ data: [] })
  const like = `%${q}%`
  const user = c.get('user')!
  const perms = c.get('permissions')
  const out: Result[] = []

  const sub = db
    .select({ id: schema.subusers.serverId })
    .from(schema.subusers)
    .where(eq(schema.subusers.userId, user.id))
  const servers = await db.query.servers.findMany({
    where: and(
      or(eq(schema.servers.ownerId, user.id), inArray(schema.servers.id, sub)),
      or(ilike(schema.servers.name, like), ilike(schema.servers.uuidShort, like)),
    ),
    limit: 5,
  })
  for (const s of servers)
    out.push({ type: 'server', title: s.name, subtitle: s.uuidShort, url: `/server/${s.uuidShort}` })

  const services = await db
    .select({ id: schema.services.id, product: schema.products.name, status: schema.services.status })
    .from(schema.services)
    .innerJoin(schema.products, eq(schema.products.id, schema.services.productId))
    .where(and(eq(schema.services.userId, user.id), ilike(schema.products.name, like)))
    .limit(5)
  for (const s of services)
    out.push({
      type: 'service',
      title: s.product,
      subtitle: `#${s.id} · ${s.status}`,
      url: `/services/${s.id}`,
    })

  const invoices = await db.query.invoices.findMany({
    where: and(eq(schema.invoices.userId, user.id), ilike(schema.invoices.number, like)),
    orderBy: desc(schema.invoices.id),
    limit: 5,
  })
  for (const i of invoices)
    out.push({ type: 'invoice', title: i.number ?? `#${i.id}`, subtitle: i.status, url: `/invoices/${i.id}` })

  const tickets = await db.query.tickets.findMany({
    where: and(eq(schema.tickets.userId, user.id), ilike(schema.tickets.subject, like)),
    orderBy: desc(schema.tickets.id),
    limit: 5,
  })
  for (const t of tickets)
    out.push({
      type: 'ticket',
      title: t.subject,
      subtitle: `#${t.id} · ${t.status}`,
      url: `/tickets/${t.id}`,
    })

  if (hasPermission(perms, 'admin.users.view')) {
    const users = await db.query.users.findMany({
      where: or(ilike(schema.users.email, like), ilike(schema.users.username, like)),
      limit: 5,
    })
    for (const u of users)
      out.push({ type: 'user', title: u.email, subtitle: u.username, url: `/admin/users/${u.id}` })
  }
  if (hasPermission(perms, 'admin.servers.view')) {
    const all = await db.query.servers.findMany({
      where: or(ilike(schema.servers.name, like), ilike(schema.servers.uuidShort, like)),
      limit: 5,
    })
    for (const s of all)
      if (!servers.some((x) => x.id === s.id))
        out.push({
          type: 'server',
          title: s.name,
          subtitle: `${s.uuidShort} · admin`,
          url: `/admin/servers/${s.id}`,
        })
  }
  return c.json({ data: out.slice(0, 20) })
})
