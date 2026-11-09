import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { config } from '../config'
import { db, schema } from '../db'
import { randomString } from '../lib/crypto'
import { HttpError } from '../lib/errors'
import { hasPermission } from '../lib/permissions'
import { mailUser } from './mail'
import { notify } from './notify'

export type Attachment = { name: string; path: string; size: number }

const MAX_FILES = 5
const MAX_SIZE = 10 * 1024 * 1024
const ALLOWED = /\.(png|jpe?g|gif|webp|pdf|txt|log|json|ya?ml|properties|zip|gz)$/i

/** Stores uploaded files under storage/tickets/<ticket>/ with random names. */
export function validateAttachments(files: File[]) {
  if (files.length > MAX_FILES) throw new HttpError(422, `At most ${MAX_FILES} files per message`, 'invalid')
  for (const f of files) {
    if (f.size > MAX_SIZE) throw new HttpError(422, `${f.name} is larger than 10 MB`, 'invalid')
    if (!ALLOWED.test(f.name)) throw new HttpError(422, `${f.name}: this file type is not allowed`, 'invalid')
  }
}

export async function saveAttachments(ticketId: number, files: File[]): Promise<Attachment[]> {
  validateAttachments(files)
  const dir = join(config.storagePath, 'tickets', String(ticketId))
  await mkdir(dir, { recursive: true })
  const out: Attachment[] = []
  for (const f of files) {
    const stored = `${randomString(16)}-${f.name.replace(/[^\w.-]+/g, '_').slice(-80)}`
    await Bun.write(join(dir, stored), f)
    out.push({ name: f.name.slice(0, 191), path: `${ticketId}/${stored}`, size: f.size })
  }
  return out
}

export const attachmentPath = (a: Attachment) => join(config.storagePath, 'tickets', a.path)

/** Users whose role can read tickets. */
async function staffIds() {
  const rows = await db
    .select({ id: schema.users.id, permissions: schema.roles.permissions })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
  return rows.filter((r) => hasPermission(r.permissions, 'admin.tickets.view')).map((r) => r.id)
}

export async function notifyStaffNewTicket(ticketId: number, message: string, kind: 'new' | 'reply' = 'new') {
  const ticket = (await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticketId) }))!
  const customer = await db.query.users.findFirst({ where: eq(schema.users.id, ticket.userId) })
  const dept = ticket.departmentId
    ? await db.query.ticketDepartments.findFirst({
        where: eq(schema.ticketDepartments.id, ticket.departmentId),
      })
    : null
  const staff = ticket.assignedTo ? [ticket.assignedTo] : await staffIds()
  for (const id of staff) {
    const title =
      kind === 'new' ? `New ticket #${ticket.id}: ${ticket.subject}` : `New reply on ticket #${ticket.id}`
    await notify(id, { title, body: customer?.email, url: `/admin/tickets/${ticket.id}` })
    await mailUser(id, kind === 'new' ? 'ticket.created_staff' : 'ticket.customer_replied', {
      id: String(ticket.id),
      subject: ticket.subject,
      customer: customer?.email ?? 'A customer',
      department: dept?.name ?? 'General',
      priority: ticket.priority,
      message: message.slice(0, 2000),
      url: `${config.url}/admin/tickets/${ticket.id}`,
    })
  }
}

export async function notifyCustomerReply(ticketId: number, staffId: number, message: string) {
  const ticket = (await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticketId) }))!
  const staff = await db.query.users.findFirst({ where: eq(schema.users.id, staffId) })
  await notify(
    ticket.userId,
    { title: `New reply on ticket #${ticket.id}`, body: ticket.subject, url: `/tickets/${ticket.id}` },
    {
      template: 'ticket.replied',
      vars: {
        subject: ticket.subject,
        id: String(ticket.id),
        staff: staff?.firstName || staff?.username || 'Support',
        message: message.slice(0, 4000),
        url: `${config.url}/tickets/${ticket.id}`,
      },
    },
  )
}

/** Messages with author info; staff authors are flagged so the UI can style them. */
export async function ticketThread(ticketId: number) {
  const messages = await db.query.ticketMessages.findMany({
    where: eq(schema.ticketMessages.ticketId, ticketId),
    orderBy: schema.ticketMessages.id,
  })
  const authorIds = [...new Set(messages.map((m) => m.userId))]
  const authors = authorIds.length
    ? await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          roleId: schema.users.roleId,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, authorIds))
    : []
  return messages.map((m) => {
    const a = authors.find((x) => x.id === m.userId)
    return {
      id: m.id,
      message: m.message,
      createdAt: m.createdAt,
      attachments: m.attachments.map((f, i) => ({ index: i, name: f.name, size: f.size })),
      author: {
        id: m.userId,
        name: [a?.firstName, a?.lastName].filter(Boolean).join(' ') || a?.username || 'Deleted user',
        staff: !!a?.roleId,
      },
    }
  })
}
