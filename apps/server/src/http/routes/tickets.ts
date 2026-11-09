import { and, asc, count, desc, eq, ilike, inArray, ne, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../db'
import { emit } from '../../extensions/registry'
import { logActivity } from '../../lib/activity'
import { HttpError, notFound } from '../../lib/errors'
import { getSetting } from '../../lib/settings'
import {
  type Attachment,
  attachmentPath,
  notifyCustomerReply,
  notifyStaffNewTicket,
  saveAttachments,
  ticketThread,
  validateAttachments,
} from '../../services/tickets'
import { clientIp, requireAuth, requirePermission } from '../middleware/auth'
import type { AppEnv } from '../types'
import { validate } from '../validate'

const intId = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound('Ticket')
  return n
}

/** Accepts JSON or multipart (message + files[]). */
async function readMessage(c: {
  req: {
    header: (n: string) => string | undefined
    json: () => Promise<unknown>
    parseBody: (o: { all: true }) => Promise<Record<string, unknown>>
  }
}) {
  if (c.req.header('content-type')?.startsWith('multipart/')) {
    const body = await c.req.parseBody({ all: true })
    const raw = body['files[]'] ?? body.files
    const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (f): f is File => f instanceof File && f.size > 0,
    )
    return { fields: body as Record<string, unknown>, files }
  }
  return { fields: (await c.req.json()) as Record<string, unknown>, files: [] as File[] }
}

const messageSchema = z.string().trim().min(1, 'Write a message').max(20000)
const createSchema = z.object({
  subject: z.string().trim().min(3).max(191),
  message: messageSchema,
  departmentId: z.coerce.number().int().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  serviceId: z.coerce.number().int().optional(),
})

async function requireTicketsEnabled() {
  if (!(await getSetting('tickets.enabled')))
    throw new HttpError(403, 'Support tickets are disabled', 'forbidden')
}

async function downloadAttachment(ticketId: number, messageId: number, index: number) {
  const msg = await db.query.ticketMessages.findFirst({
    where: and(eq(schema.ticketMessages.id, messageId), eq(schema.ticketMessages.ticketId, ticketId)),
  })
  const file = msg?.attachments[index] as Attachment | undefined
  if (!file) throw notFound('Attachment')
  const blob = Bun.file(attachmentPath(file))
  if (!(await blob.exists())) throw notFound('Attachment')
  return new Response(blob, {
    headers: {
      'content-disposition': `attachment; filename="${file.name.replace(/"/g, '')}"`,
      // Never let the browser render uploads inline.
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    },
  })
}

export const clientTicketRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/departments', async (c) =>
    c.json({
      data: await db.query.ticketDepartments.findMany({ orderBy: asc(schema.ticketDepartments.sort) }),
    }),
  )
  .get('/', async (c) => {
    const rows = await db.query.tickets.findMany({
      where: eq(schema.tickets.userId, c.get('user')!.id),
      orderBy: desc(schema.tickets.updatedAt),
    })
    return c.json({ data: rows })
  })
  .post('/', async (c) => {
    await requireTicketsEnabled()
    const user = c.get('user')!
    const { fields, files } = await readMessage(c)
    const parsed = createSchema.safeParse(fields)
    if (!parsed.success)
      throw new HttpError(
        422,
        parsed.error.issues[0]!.message,
        'invalid',
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
      )
    const body = parsed.data
    validateAttachments(files)
    // Light anti-spam: at most 5 open tickets per customer.
    const [open] = await db
      .select({ n: count() })
      .from(schema.tickets)
      .where(and(eq(schema.tickets.userId, user.id), ne(schema.tickets.status, 'closed')))
    if (open!.n >= 5)
      throw new HttpError(
        429,
        'You already have 5 open tickets. Please wait for a reply or close one.',
        'limit',
      )
    if (body.serviceId) {
      const own = await db.query.services.findFirst({
        where: and(eq(schema.services.id, body.serviceId), eq(schema.services.userId, user.id)),
      })
      if (!own) throw new HttpError(422, 'Service not found', 'invalid')
    }
    const [ticket] = await db
      .insert(schema.tickets)
      .values({
        userId: user.id,
        subject: body.subject,
        priority: body.priority,
        departmentId: body.departmentId ?? null,
        serviceId: body.serviceId ?? null,
        status: 'open',
      })
      .returning()
    const attachments = await saveAttachments(ticket!.id, files)
    await db
      .insert(schema.ticketMessages)
      .values({ ticketId: ticket!.id, userId: user.id, message: body.message, attachments })
    await logActivity({
      event: 'ticket:create',
      actorId: user.id,
      ip: clientIp(c),
      subject: { type: 'ticket', id: ticket!.id },
    })
    await emit('ticket.created', { ticketId: ticket!.id, userId: user.id })
    await notifyStaffNewTicket(ticket!.id, body.message)
    return c.json({ data: { id: ticket!.id } }, 201)
  })
  .get('/:id', async (c) => {
    const ticket = await db.query.tickets.findFirst({
      where: and(
        eq(schema.tickets.id, intId(c.req.param('id'))),
        eq(schema.tickets.userId, c.get('user')!.id),
      ),
    })
    if (!ticket) throw notFound('Ticket')
    const dept = ticket.departmentId
      ? await db.query.ticketDepartments.findFirst({
          where: eq(schema.ticketDepartments.id, ticket.departmentId),
        })
      : null
    return c.json({
      data: { ...ticket, department: dept?.name ?? null, messages: await ticketThread(ticket.id) },
    })
  })
  .post('/:id/reply', async (c) => {
    await requireTicketsEnabled()
    const user = c.get('user')!
    const ticket = await db.query.tickets.findFirst({
      where: and(eq(schema.tickets.id, intId(c.req.param('id'))), eq(schema.tickets.userId, user.id)),
    })
    if (!ticket) throw notFound('Ticket')
    const { fields, files } = await readMessage(c)
    const message = messageSchema.safeParse(fields.message)
    if (!message.success) throw new HttpError(422, message.error.issues[0]!.message, 'invalid')
    const attachments = await saveAttachments(ticket.id, files)
    await db
      .insert(schema.ticketMessages)
      .values({ ticketId: ticket.id, userId: user.id, message: message.data, attachments })
    // A customer reply reopens a closed ticket.
    await db.update(schema.tickets).set({ status: 'replied' }).where(eq(schema.tickets.id, ticket.id))
    await notifyStaffNewTicket(ticket.id, message.data, 'reply')
    await emit('ticket.replied', { ticketId: ticket.id, userId: user.id, staff: false })
    return c.json({ ok: true })
  })
  .post('/:id/close', async (c) => {
    const res = await db
      .update(schema.tickets)
      .set({ status: 'closed' })
      .where(
        and(eq(schema.tickets.id, intId(c.req.param('id'))), eq(schema.tickets.userId, c.get('user')!.id)),
      )
      .returning()
    if (!res.length) throw notFound('Ticket')
    return c.json({ ok: true })
  })
  .get('/:id/messages/:message/attachments/:index', async (c) => {
    const id = intId(c.req.param('id'))
    const own = await db.query.tickets.findFirst({
      where: and(eq(schema.tickets.id, id), eq(schema.tickets.userId, c.get('user')!.id)),
    })
    if (!own) throw notFound('Ticket')
    return downloadAttachment(id, intId(c.req.param('message')), Number(c.req.param('index')))
  })

export const adminTicketRoutes = new Hono<AppEnv>()
  .get('/tickets', requirePermission('admin.tickets.view'), async (c) => {
    const status = c.req.query('status')
    const q = c.req.query('q')?.trim()
    const conditions = [
      status === 'active'
        ? ne(schema.tickets.status, 'closed')
        : status
          ? eq(schema.tickets.status, status)
          : undefined,
      q ? or(ilike(schema.tickets.subject, `%${q}%`), ilike(schema.users.email, `%${q}%`)) : undefined,
    ]
    const rows = await db
      .select({
        ticket: schema.tickets,
        customer: { email: schema.users.email, username: schema.users.username },
        department: schema.ticketDepartments.name,
      })
      .from(schema.tickets)
      .innerJoin(schema.users, eq(schema.users.id, schema.tickets.userId))
      .leftJoin(schema.ticketDepartments, eq(schema.ticketDepartments.id, schema.tickets.departmentId))
      .where(and(...conditions))
      .orderBy(desc(schema.tickets.updatedAt))
      .limit(200)
    return c.json({
      data: rows.map((r) => ({ ...r.ticket, customer: r.customer, department: r.department })),
    })
  })
  .get('/tickets/:id', requirePermission('admin.tickets.view'), async (c) => {
    const ticket = await db.query.tickets.findFirst({
      where: eq(schema.tickets.id, intId(c.req.param('id'))),
    })
    if (!ticket) throw notFound('Ticket')
    const customer = await db.query.users.findFirst({
      where: eq(schema.users.id, ticket.userId),
      columns: { id: true, email: true, username: true, firstName: true, lastName: true },
    })
    const services = await db
      .select({ id: schema.services.id, status: schema.services.status, product: schema.products.name })
      .from(schema.services)
      .innerJoin(schema.products, eq(schema.products.id, schema.services.productId))
      .where(eq(schema.services.userId, ticket.userId))
    const staffRoles = await db.query.roles.findMany()
    const staff = await db.query.users.findMany({
      where: inArray(schema.users.roleId, staffRoles.map((r) => r.id).concat(-1)),
      columns: { id: true, username: true, email: true },
    })
    return c.json({ data: { ...ticket, customer, services, staff, messages: await ticketThread(ticket.id) } })
  })
  .post('/tickets/:id/reply', requirePermission('admin.tickets.manage'), async (c) => {
    const ticket = await db.query.tickets.findFirst({
      where: eq(schema.tickets.id, intId(c.req.param('id'))),
    })
    if (!ticket) throw notFound('Ticket')
    const { fields, files } = await readMessage(c)
    const message = messageSchema.safeParse(fields.message)
    if (!message.success) throw new HttpError(422, message.error.issues[0]!.message, 'invalid')
    const attachments = await saveAttachments(ticket.id, files)
    const me = c.get('user')!
    await db
      .insert(schema.ticketMessages)
      .values({ ticketId: ticket.id, userId: me.id, message: message.data, attachments })
    const close = fields.close === true || fields.close === 'true'
    await db
      .update(schema.tickets)
      .set({ status: close ? 'closed' : 'answered', assignedTo: ticket.assignedTo ?? me.id })
      .where(eq(schema.tickets.id, ticket.id))
    await notifyCustomerReply(ticket.id, me.id, message.data)
    await emit('ticket.replied', { ticketId: ticket.id, userId: me.id, staff: true })
    await logActivity({
      event: 'admin:ticket.reply',
      actorId: me.id,
      ip: clientIp(c),
      subject: { type: 'ticket', id: ticket.id },
    })
    return c.json({ ok: true })
  })
  .patch(
    '/tickets/:id',
    requirePermission('admin.tickets.manage'),
    validate(
      'json',
      z
        .object({
          status: z.enum(['open', 'answered', 'replied', 'closed']),
          priority: z.enum(['low', 'medium', 'high']),
          assignedTo: z.number().int().nullable(),
          departmentId: z.number().int().nullable(),
        })
        .partial(),
    ),
    async (c) => {
      const res = await db
        .update(schema.tickets)
        .set(c.req.valid('json'))
        .where(eq(schema.tickets.id, intId(c.req.param('id'))))
        .returning()
      if (!res.length) throw notFound('Ticket')
      return c.json({ ok: true })
    },
  )
  .get(
    '/tickets/:id/messages/:message/attachments/:index',
    requirePermission('admin.tickets.view'),
    async (c) =>
      downloadAttachment(
        intId(c.req.param('id')),
        intId(c.req.param('message')),
        Number(c.req.param('index')),
      ),
  )
  // Departments
  .get('/ticket-departments', requirePermission('admin.tickets.manage'), async (c) =>
    c.json({
      data: await db.query.ticketDepartments.findMany({ orderBy: asc(schema.ticketDepartments.sort) }),
    }),
  )
  .post(
    '/ticket-departments',
    requirePermission('admin.tickets.manage'),
    validate('json', z.object({ name: z.string().min(1).max(64) })),
    async (c) => {
      const [row] = await db.insert(schema.ticketDepartments).values(c.req.valid('json')).returning()
      return c.json({ data: row }, 201)
    },
  )
  .delete('/ticket-departments/:id', requirePermission('admin.tickets.manage'), async (c) => {
    await db.delete(schema.ticketDepartments).where(eq(schema.ticketDepartments.id, intId(c.req.param('id'))))
    return c.json({ ok: true })
  })
