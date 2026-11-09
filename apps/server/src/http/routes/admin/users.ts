import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { hashPassword } from '../../../lib/crypto'
import { HttpError, notFound } from '../../../lib/errors'
import { adminPermissions, hasPermission } from '../../../lib/permissions'
import { addCredits } from '../../../services/billing/invoices'
import { toCents } from '../../../services/billing/money'
import { clientIp, createSession, destroySession, newUuid, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { onlyProvided, validate } from '../../validate'

const uid = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound('User')
  return n
}

const userBody = z.object({
  email: z.email().max(191),
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  firstName: z.string().max(64).nullish(),
  lastName: z.string().max(64).nullish(),
  password: z.string().min(8).max(256).optional(),
  roleId: z.number().int().nullish(),
  suspended: z.boolean().optional(),
  country: z.string().length(2).nullish(),
})

const publicUser = (u: typeof schema.users.$inferSelect) => ({
  id: u.id,
  uuid: u.uuid,
  email: u.email,
  username: u.username,
  firstName: u.firstName,
  lastName: u.lastName,
  roleId: u.roleId,
  credits: u.credits,
  country: (u.properties.country as string | undefined) ?? null,
  emailVerified: !!u.emailVerifiedAt,
  twoFactorEnabled: !!u.totpEnabledAt,
  suspended: !!u.suspendedAt,
  createdAt: u.createdAt,
})

/** Only full administrators may grant or act on roles holding `*`. */
async function assertCanManageRole(actorPermissions: string[], roleId: number | null | undefined) {
  if (!roleId) return
  const role = await db.query.roles.findFirst({ where: eq(schema.roles.id, roleId) })
  if (!role) throw new HttpError(422, 'Role not found', 'invalid')
  if (role.permissions.includes('*') && !actorPermissions.includes('*'))
    throw new HttpError(403, 'Only full administrators can manage this role', 'forbidden')
}

export const adminUserRoutes = new Hono<AppEnv>()
  .get('/users', requirePermission('admin.users.view'), async (c) => {
    const q = c.req.query('q')?.trim()
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const where = q
      ? or(
          ilike(schema.users.email, `%${q}%`),
          ilike(schema.users.username, `%${q}%`),
          ilike(schema.users.firstName, `%${q}%`),
          ilike(schema.users.lastName, `%${q}%`),
        )
      : undefined
    const [total] = await db.select({ n: count() }).from(schema.users).where(where)
    const rows = await db.query.users.findMany({
      where,
      orderBy: desc(schema.users.id),
      limit: 50,
      offset: (page - 1) * 50,
    })
    const ids = rows.map((r) => r.id)
    const servers = ids.length
      ? await db
          .select({ owner: schema.servers.ownerId, n: count() })
          .from(schema.servers)
          .where(inArray(schema.servers.ownerId, ids))
          .groupBy(schema.servers.ownerId)
      : []
    const roles = await db.query.roles.findMany()
    return c.json({
      data: rows.map((u) => ({
        ...publicUser(u),
        role: roles.find((r) => r.id === u.roleId)?.name ?? null,
        servers: servers.find((s) => s.owner === u.id)?.n ?? 0,
      })),
      total: total!.n,
      page,
    })
  })
  .get('/users/:id', requirePermission('admin.users.view'), async (c) => {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, uid(c.req.param('id'))) })
    if (!user) throw notFound('User')
    const servers = await db.query.servers.findMany({
      where: eq(schema.servers.ownerId, user.id),
      columns: { id: true, uuidShort: true, name: true, status: true },
    })
    const services = await db
      .select({
        id: schema.services.id,
        status: schema.services.status,
        product: schema.products.name,
        price: schema.services.price,
        currency: schema.services.currencyCode,
      })
      .from(schema.services)
      .innerJoin(schema.products, eq(schema.products.id, schema.services.productId))
      .where(eq(schema.services.userId, user.id))
      .orderBy(desc(schema.services.id))
    const invoices = await db.query.invoices.findMany({
      where: eq(schema.invoices.userId, user.id),
      orderBy: desc(schema.invoices.id),
      limit: 20,
    })
    const activity = await db.query.activityLogs.findMany({
      where: eq(schema.activityLogs.actorId, user.id),
      orderBy: desc(schema.activityLogs.id),
      limit: 20,
    })
    return c.json({ data: { ...publicUser(user), servers, services, invoices, activity } })
  })
  .post(
    '/users',
    requirePermission('admin.users.manage'),
    validate('json', userBody.extend({ password: z.string().min(8).max(256) })),
    async (c) => {
      const body = c.req.valid('json')
      await assertCanManageRole(c.get('permissions'), body.roleId)
      const taken = await db.query.users.findFirst({
        where: or(eq(schema.users.email, body.email.toLowerCase()), eq(schema.users.username, body.username)),
      })
      if (taken) throw new HttpError(409, 'Email or username is already taken', 'taken')
      const [user] = await db
        .insert(schema.users)
        .values({
          uuid: newUuid(),
          email: body.email.toLowerCase(),
          username: body.username,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          password: await hashPassword(body.password),
          roleId: body.roleId ?? null,
          emailVerifiedAt: new Date(),
          properties: body.country ? { country: body.country.toUpperCase() } : {},
        })
        .returning()
      await logActivity({
        event: 'admin:user.create',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'user', id: user!.id },
      })
      return c.json({ data: publicUser(user!) }, 201)
    },
  )
  .patch(
    '/users/:id',
    requirePermission('admin.users.manage'),
    validate('json', userBody.partial()),
    async (c) => {
      const id = uid(c.req.param('id'))
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) })
      if (!user) throw notFound('User')
      const body = await onlyProvided(c, c.req.valid('json'))
      const me = c.get('user')!
      await assertCanManageRole(c.get('permissions'), user.roleId)
      if ('roleId' in body) await assertCanManageRole(c.get('permissions'), body.roleId)
      if (id === me.id && ('roleId' in body || body.suspended))
        throw new HttpError(422, 'You cannot change your own role or suspend yourself', 'invalid')
      if (body.email || body.username) {
        const taken = await db.query.users.findFirst({
          where: and(
            ne(schema.users.id, id),
            or(
              eq(schema.users.email, (body.email ?? user.email).toLowerCase()),
              eq(schema.users.username, body.username ?? user.username),
            ),
          ),
        })
        if (taken) throw new HttpError(409, 'Email or username is already taken', 'taken')
      }
      const values: Partial<typeof schema.users.$inferInsert> = {}
      if (body.email) values.email = body.email.toLowerCase()
      if (body.username) values.username = body.username
      if ('firstName' in body) values.firstName = body.firstName ?? null
      if ('lastName' in body) values.lastName = body.lastName ?? null
      if ('roleId' in body) values.roleId = body.roleId ?? null
      if (body.password) values.password = await hashPassword(body.password)
      if ('suspended' in body) values.suspendedAt = body.suspended ? new Date() : null
      if ('country' in body)
        values.properties = { ...user.properties, country: body.country?.toUpperCase() ?? undefined }
      const [updated] = await db.update(schema.users).set(values).where(eq(schema.users.id, id)).returning()
      // A suspended user or a changed password logs out everywhere.
      if (body.suspended || body.password)
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, id))
      await logActivity({
        event: 'admin:user.update',
        actorId: me.id,
        ip: clientIp(c),
        subject: { type: 'user', id },
        properties: { fields: Object.keys(body).filter((k) => k !== 'password') },
      })
      return c.json({ data: publicUser(updated!) })
    },
  )
  .post(
    '/users/:id/credits',
    requirePermission('admin.users.manage'),
    validate(
      'json',
      z.object({
        amount: z.union([z.string(), z.number()]),
        currency: z.string().length(3),
        note: z.string().max(191).optional(),
      }),
    ),
    async (c) => {
      const id = uid(c.req.param('id'))
      const { amount, currency, note } = c.req.valid('json')
      const cents = toCents(amount)
      if (!cents) throw new HttpError(422, 'Amount cannot be zero', 'invalid')
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) })
      if (!user) throw notFound('User')
      if (toCents(user.credits[currency.toUpperCase()] ?? '0') + cents < 0)
        throw new HttpError(422, 'The balance cannot go below zero', 'invalid')
      await addCredits(id, currency.toUpperCase(), cents)
      await logActivity({
        event: 'admin:user.credits',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'user', id },
        properties: { amount: String(amount), currency, note },
      })
      return c.json({ ok: true })
    },
  )
  .delete('/users/:id', requirePermission('admin.users.manage'), async (c) => {
    const id = uid(c.req.param('id'))
    if (id === c.get('user')!.id) throw new HttpError(422, 'You cannot delete your own account', 'invalid')
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) })
    if (!user) throw notFound('User')
    await assertCanManageRole(c.get('permissions'), user.roleId)
    const [servers] = await db
      .select({ n: count() })
      .from(schema.servers)
      .where(eq(schema.servers.ownerId, id))
    const [services] = await db
      .select({ n: count() })
      .from(schema.services)
      .where(and(eq(schema.services.userId, id), ne(schema.services.status, 'cancelled')))
    if (servers!.n || services!.n)
      throw new HttpError(
        409,
        'Delete or transfer this user’s servers and cancel their services first',
        'in_use',
      )
    const [invoices] = await db
      .select({ n: count() })
      .from(schema.invoices)
      .where(eq(schema.invoices.userId, id))
    // Keep financial history: users with invoices are suspended instead of deleted.
    if (invoices!.n)
      throw new HttpError(
        409,
        'This user has invoices, which must be kept. Suspend the account instead.',
        'in_use',
      )
    await db.delete(schema.subusers).where(eq(schema.subusers.userId, id))
    await db.delete(schema.users).where(eq(schema.users.id, id))
    await logActivity({
      event: 'admin:user.delete',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      properties: { email: user.email },
    })
    return c.json({ ok: true })
  })
  .post('/users/:id/impersonate', requirePermission('admin.users.impersonate'), async (c) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, uid(c.req.param('id'))) })
    if (!target) throw notFound('User')
    const me = c.get('user')!
    if (target.id === me.id) throw new HttpError(422, 'You are already signed in as yourself', 'invalid')
    if (target.roleId && !c.get('permissions').includes('*'))
      throw new HttpError(403, 'Only full administrators can sign in as staff accounts', 'forbidden')
    if (target.suspendedAt) throw new HttpError(422, 'This account is suspended', 'invalid')
    const original = c.get('session')!
    await logActivity({
      event: 'admin:user.impersonate',
      actorId: me.id,
      ip: clientIp(c),
      subject: { type: 'user', id: target.id },
    })
    await db.delete(schema.sessions).where(eq(schema.sessions.id, original.id))
    await createSession(c, target, { impersonatorId: me.id })
    return c.json({ ok: true })
  })

  // ── Roles ────────────────────────────────────────────────
  .get('/roles', requirePermission('admin.roles.manage'), async (c) => {
    const roles = await db.query.roles.findMany({ orderBy: asc(schema.roles.id) })
    const usage = await db
      .select({ roleId: schema.users.roleId, n: count() })
      .from(schema.users)
      .groupBy(schema.users.roleId)
    return c.json({
      data: roles.map((r) => ({ ...r, users: usage.find((u) => u.roleId === r.id)?.n ?? 0 })),
      available: adminPermissions,
    })
  })
  .post(
    '/roles',
    requirePermission('admin.roles.manage'),
    validate(
      'json',
      z.object({ name: z.string().min(1).max(64), permissions: z.array(z.string()).max(100) }),
    ),
    async (c) => {
      const { name, permissions } = c.req.valid('json')
      const invalid = permissions.filter((p) => p !== '*' && !(p in adminPermissions))
      if (invalid.length) throw new HttpError(422, `Unknown permissions: ${invalid.join(', ')}`, 'invalid')
      if (permissions.some((p) => !hasPermission(c.get('permissions'), p)))
        throw new HttpError(403, 'You cannot grant permissions you do not have', 'forbidden')
      const [role] = await db.insert(schema.roles).values({ name, permissions }).returning()
      return c.json({ data: role }, 201)
    },
  )
  .put(
    '/roles/:id',
    requirePermission('admin.roles.manage'),
    validate(
      'json',
      z.object({ name: z.string().min(1).max(64), permissions: z.array(z.string()).max(100) }),
    ),
    async (c) => {
      const id = uid(c.req.param('id'))
      await assertCanManageRole(c.get('permissions'), id)
      const { name, permissions } = c.req.valid('json')
      if (permissions.some((p) => !hasPermission(c.get('permissions'), p)))
        throw new HttpError(403, 'You cannot grant permissions you do not have', 'forbidden')
      const [role] = await db
        .update(schema.roles)
        .set({ name, permissions })
        .where(eq(schema.roles.id, id))
        .returning()
      if (!role) throw notFound('Role')
      return c.json({ data: role })
    },
  )
  .delete('/roles/:id', requirePermission('admin.roles.manage'), async (c) => {
    const id = uid(c.req.param('id'))
    await assertCanManageRole(c.get('permissions'), id)
    const [used] = await db.select({ n: count() }).from(schema.users).where(eq(schema.users.roleId, id))
    if (used!.n) throw new HttpError(409, 'Move the users of this role to another role first', 'in_use')
    await db.delete(schema.roles).where(eq(schema.roles.id, id))
    return c.json({ ok: true })
  })

  // ── Dashboard ────────────────────────────────────────────
  .get('/overview', requirePermission('admin.dashboard'), async (c) => {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    const [[users], [servers], [activeServices], [pendingInvoices], [openTickets]] = await Promise.all([
      db.select({ n: count() }).from(schema.users),
      db.select({ n: count() }).from(schema.servers),
      db.select({ n: count() }).from(schema.services).where(eq(schema.services.status, 'active')),
      db.select({ n: count() }).from(schema.invoices).where(eq(schema.invoices.status, 'pending')),
      db.select({ n: count() }).from(schema.tickets).where(ne(schema.tickets.status, 'closed')),
    ])
    // Revenue = money actually received from gateways this month (credit spending is not new revenue).
    const revenue = await db
      .select({
        currency: schema.invoices.currencyCode,
        total: sql<string>`coalesce(sum(${schema.invoiceTransactions.amount}), 0)`,
      })
      .from(schema.invoiceTransactions)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceTransactions.invoiceId))
      .where(
        and(
          eq(schema.invoiceTransactions.status, 'succeeded'),
          sql`${schema.invoiceTransactions.gateway} is not null`,
          sql`${schema.invoiceTransactions.createdAt} >= ${monthStart.toISOString()}`,
        ),
      )
      .groupBy(schema.invoices.currencyCode)
    // Monthly recurring revenue: active recurring services normalised to one month.
    const mrr = await db
      .select({
        currency: schema.services.currencyCode,
        total: sql<string>`coalesce(sum(${schema.services.price} * ${schema.services.quantity} * case ${schema.plans.billingUnit}
          when 'day' then 30.4375 / ${schema.plans.billingPeriod}
          when 'week' then 4.348 / ${schema.plans.billingPeriod}
          when 'month' then 1.0 / ${schema.plans.billingPeriod}
          when 'year' then 1.0 / (12 * ${schema.plans.billingPeriod}) end), 0)`,
      })
      .from(schema.services)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.services.planId))
      .where(and(eq(schema.services.status, 'active'), eq(schema.plans.type, 'recurring')))
      .groupBy(schema.services.currencyCode)
    const nodes = await db.query.nodes.findMany({
      columns: { id: true, name: true, memory: true, disk: true, lastHeartbeatAt: true, maintenance: true },
    })
    const usage = await db
      .select({
        nodeId: schema.servers.nodeId,
        memory: sql<number>`sum(${schema.servers.memory})::int`,
        disk: sql<number>`sum(${schema.servers.disk})::int`,
        n: count(),
      })
      .from(schema.servers)
      .groupBy(schema.servers.nodeId)
    const recent = await db
      .select({ log: schema.activityLogs, actor: schema.users.username })
      .from(schema.activityLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.activityLogs.actorId))
      .where(
        sql`${schema.activityLogs.event} like 'billing:%' or ${schema.activityLogs.event} like 'admin:%' or ${schema.activityLogs.event} like 'auth:register'`,
      )
      .orderBy(desc(schema.activityLogs.id))
      .limit(12)
    const pendingSetup = await db
      .select({ n: count() })
      .from(schema.services)
      .where(
        and(eq(schema.services.status, 'pending'), sql`${schema.services.properties} ? 'provisionError'`),
      )
    return c.json({
      stats: {
        users: users!.n,
        servers: servers!.n,
        activeServices: activeServices!.n,
        pendingInvoices: pendingInvoices!.n,
        openTickets: openTickets!.n,
        failedSetups: pendingSetup[0]!.n,
      },
      revenue: revenue.map((r) => ({ currency: r.currency, amount: Number(r.total).toFixed(2) })),
      mrr: mrr.map((r) => ({ currency: r.currency, amount: Number(r.total).toFixed(2) })),
      nodes: nodes.map((n) => {
        const u = usage.find((x) => x.nodeId === n.id)
        return {
          ...n,
          online: !!n.lastHeartbeatAt && Date.now() - n.lastHeartbeatAt.getTime() < 90_000,
          servers: u?.n ?? 0,
          memoryUsed: u?.memory ?? 0,
          diskUsed: u?.disk ?? 0,
        }
      }),
      recent: recent.map((r) => ({
        id: r.log.id,
        event: r.log.event,
        actor: r.actor,
        createdAt: r.log.createdAt,
        properties: r.log.properties,
      })),
    })
  })

/** Ends an impersonation and signs the original administrator back in. */
export const impersonationRoutes = new Hono<AppEnv>().post('/impersonate/stop', async (c) => {
  const session = c.get('session')
  if (!session?.impersonatorId) throw new HttpError(400, 'You are not signed in as another user', 'invalid')
  const admin = await db.query.users.findFirst({ where: eq(schema.users.id, session.impersonatorId) })
  await destroySession(c)
  if (!admin) return c.json({ ok: true })
  await createSession(c, admin)
  return c.json({ ok: true })
})
