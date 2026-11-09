import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { User } from '../http/types'
import { forbidden, notFound } from '../lib/errors'
import { allServerPermissions, hasPermission } from '../lib/permissions'

export type ServerAccess = Awaited<ReturnType<typeof serverAccess>>

/**
 * Loads a server by uuid / short uuid / id and resolves what the user may do on it.
 * Owners and admins with `admin.servers.manage` get every permission.
 */
export async function serverAccess(user: User, adminPermissions: string[], identifier: string) {
  const where = /^\d+$/.test(identifier)
    ? eq(schema.servers.id, Number(identifier))
    : identifier.length === 8
      ? eq(schema.servers.uuidShort, identifier)
      : eq(schema.servers.uuid, identifier)
  const server = await db.query.servers.findFirst({ where })
  if (!server) throw notFound('Server')

  let permissions: string[] = []
  const isAdmin = hasPermission(adminPermissions, 'admin.servers.manage')
  if (server.ownerId === user.id || isAdmin) {
    permissions = ['*']
  } else {
    const sub = await db.query.subusers.findFirst({
      where: and(eq(schema.subusers.serverId, server.id), eq(schema.subusers.userId, user.id)),
    })
    if (!sub) throw notFound('Server')
    permissions = sub.permissions
  }
  const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) })
  return {
    server,
    node: node!,
    permissions,
    isOwner: server.ownerId === user.id,
    isAdmin,
    can: (p: string) => hasPermission(permissions, p),
    require(p: string) {
      if (!hasPermission(permissions, p)) throw forbidden()
    },
    /** Server must not be suspended or installing for most actions. */
    requireReady() {
      if (server.status === 'suspended') throw forbidden('This server is suspended.')
      if (server.status === 'installing') throw forbidden('This server is still installing.')
    },
  }
}

export const expandPermissions = (p: string[]) => (p.includes('*') ? allServerPermissions : p)
