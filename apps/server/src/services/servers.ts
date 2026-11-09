import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { HttpError } from '../lib/errors'
import { daemonRequest } from './daemon'

export type CreateServerInput = {
  name: string
  description?: string | null
  ownerId: number
  eggId: number
  nodeId: number
  allocationId: number
  additionalAllocationIds?: number[]
  memory: number
  swap?: number
  disk: number
  io?: number
  cpu?: number
  threads?: string | null
  oomDisabled?: boolean
  image?: string
  startup?: string
  environment?: Record<string, string>
  databaseLimit?: number
  allocationLimit?: number
  backupLimit?: number
  skipScripts?: boolean
  startOnCompletion?: boolean
  externalId?: string | null
}

/** Checks a value against a Laravel-style rule string used by Pterodactyl eggs (e.g. `required|string|max:20`). */
export function validateVariable(rules: string, value: string): string | null {
  const list = rules
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean)
  const nullable = list.includes('nullable')
  if (value === '' && nullable) return null
  for (const rule of list) {
    const [name, arg = ''] = rule.split(/:(.*)/s) as [string, string?]
    const isNum = list.includes('numeric') || list.includes('integer')
    switch (name) {
      case 'required':
        if (value === '') return 'is required'
        break
      case 'numeric':
        if (value !== '' && Number.isNaN(Number(value))) return 'must be a number'
        break
      case 'integer':
        if (value !== '' && !/^-?\d+$/.test(value)) return 'must be an integer'
        break
      case 'boolean':
        if (!['0', '1', 'true', 'false', ''].includes(value)) return 'must be true or false'
        break
      case 'min':
        if (isNum ? Number(value) < Number(arg) : value.length < Number(arg)) return `must be at least ${arg}`
        break
      case 'max':
        if (isNum ? Number(value) > Number(arg) : value.length > Number(arg))
          return `may not be greater than ${arg}`
        break
      case 'between': {
        const [lo, hi] = arg.split(',').map(Number) as [number, number]
        const n = isNum ? Number(value) : value.length
        if (n < lo || n > hi) return `must be between ${lo} and ${hi}`
        break
      }
      case 'in':
        if (value !== '' && !arg.split(',').includes(value)) return `must be one of: ${arg}`
        break
      case 'regex': {
        const m = arg.match(/^\/(.*)\/([a-z]*)$/s)
        try {
          if (m && value !== '' && !new RegExp(m[1]!, m[2]!.replace(/[^gimsuy]/g, '')).test(value))
            return 'has an invalid format'
        } catch {}
        break
      }
      case 'alpha_dash':
        if (!/^[\w-]*$/.test(value)) return 'may only contain letters, numbers, dashes and underscores'
        break
      case 'url':
        if (value !== '' && !URL.canParse(value)) return 'must be a valid URL'
        break
    }
  }
  return null
}

export async function createServer(input: CreateServerInput) {
  const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, input.eggId) })
  if (!egg) throw new HttpError(422, 'Egg not found', 'invalid')
  const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, input.nodeId) })
  if (!node) throw new HttpError(422, 'Node not found', 'invalid')
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, input.ownerId) })
  if (!owner) throw new HttpError(422, 'Owner not found', 'invalid')

  // Resource check against node capacity (with overallocation, -1 = unlimited)
  const [used] = await db
    .select({
      memory: sql<number>`coalesce(sum(${schema.servers.memory}),0)::int`,
      disk: sql<number>`coalesce(sum(${schema.servers.disk}),0)::int`,
    })
    .from(schema.servers)
    .where(eq(schema.servers.nodeId, node.id))
  const cap = (total: number, over: number) =>
    over < 0 ? Number.POSITIVE_INFINITY : total * (1 + over / 100)
  if (used!.memory + input.memory > cap(node.memory, node.memoryOverallocate)) {
    throw new HttpError(422, 'The node does not have enough memory for this server', 'node_full')
  }
  if (used!.disk + input.disk > cap(node.disk, node.diskOverallocate)) {
    throw new HttpError(422, 'The node does not have enough disk space for this server', 'node_full')
  }

  const variables = await db.query.eggVariables.findMany({ where: eq(schema.eggVariables.eggId, egg.id) })
  const values: { variableId: number; value: string }[] = []
  const errors: Record<string, string> = {}
  for (const v of variables) {
    const value = input.environment?.[v.envVariable] ?? v.defaultValue
    const err = validateVariable(v.rules, value)
    if (err) errors[`environment.${v.envVariable}`] = `${v.name} ${err}`
    values.push({ variableId: v.id, value })
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Invalid server variables', 'invalid', errors)

  const image = input.image ?? Object.values(egg.dockerImages)[0]
  if (!image) throw new HttpError(422, 'The egg has no docker images', 'invalid')

  const uuid = crypto.randomUUID()
  const server = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.servers)
      .values({
        uuid,
        uuidShort: uuid.slice(0, 8),
        externalId: input.externalId ?? null,
        name: input.name,
        description: input.description ?? null,
        status: 'installing',
        skipScripts: input.skipScripts ?? false,
        ownerId: owner.id,
        nodeId: node.id,
        allocationId: input.allocationId,
        nestId: egg.nestId,
        eggId: egg.id,
        memory: input.memory,
        swap: input.swap ?? 0,
        disk: input.disk,
        io: input.io ?? 500,
        cpu: input.cpu ?? 0,
        threads: input.threads ?? null,
        oomDisabled: input.oomDisabled ?? true,
        startup: input.startup ?? egg.startup,
        image,
        databaseLimit: input.databaseLimit ?? 0,
        allocationLimit: input.allocationLimit ?? 0,
        backupLimit: input.backupLimit ?? 0,
      })
      .returning()
    const ids = [input.allocationId, ...(input.additionalAllocationIds ?? [])]
    for (const id of ids) {
      const claimed = await tx
        .update(schema.allocations)
        .set({ serverId: row!.id })
        .where(
          and(
            eq(schema.allocations.id, id),
            eq(schema.allocations.nodeId, node.id),
            isNull(schema.allocations.serverId),
          ),
        )
        .returning()
      if (!claimed.length)
        throw new HttpError(422, `Allocation ${id} is not available on this node`, 'invalid')
    }
    if (values.length)
      await tx.insert(schema.serverVariables).values(values.map((v) => ({ ...v, serverId: row!.id })))
    return row!
  })

  try {
    await daemonRequest(node, 'POST', '/api/servers', {
      uuid,
      start_on_completion: input.startOnCompletion ?? false,
    })
  } catch (e) {
    // Undo everything so a retry starts clean and no orphan server is left behind.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.allocations)
        .set({ serverId: null })
        .where(eq(schema.allocations.serverId, server.id))
      await tx.delete(schema.servers).where(eq(schema.servers.id, server.id))
    })
    throw e
  }
  return server
}

async function loadServer(id: number) {
  const server = await db.query.servers.findFirst({ where: eq(schema.servers.id, id) })
  if (!server) throw new HttpError(404, 'Server not found', 'not_found')
  const node = (await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) }))!
  return { server, node }
}

/** Suspends or unsuspends a server and tells the daemon (which stops it). */
export async function setServerSuspended(id: number, suspended: boolean) {
  const { server, node } = await loadServer(id)
  await db
    .update(schema.servers)
    .set({ status: suspended ? 'suspended' : null })
    .where(eq(schema.servers.id, server.id))
  await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/sync`).catch((e) =>
    console.error('daemon sync failed:', e.message),
  )
}

/** Deletes a server from the daemon and the database, freeing its allocations. */
export async function deleteServer(id: number, force = false) {
  const { server, node } = await loadServer(id)
  // Databases and backup archives live outside the server folder, remove them too.
  const { deleteDatabase } = await import('./databases')
  for (const database of await db.query.serverDatabases.findMany({
    where: eq(schema.serverDatabases.serverId, server.id),
  })) {
    await deleteDatabase(database).catch((e) => {
      if (!force) throw e
    })
  }
  const { deleteBackupFile } = await import('./backups')
  for (const backup of await db.query.backups.findMany({ where: eq(schema.backups.serverId, server.id) })) {
    await deleteBackupFile(server, node, backup).catch(() => {})
  }
  await daemonRequest(node, 'DELETE', `/api/servers/${server.uuid}`).catch((e) => {
    if (!force) throw e
  })
  await db.transaction(async (tx) => {
    await tx
      .update(schema.allocations)
      .set({ serverId: null, notes: null })
      .where(eq(schema.allocations.serverId, server.id))
    await tx.delete(schema.servers).where(eq(schema.servers.id, server.id))
  })
  return server
}

/** Changes resource limits; applied by the daemon on next start. */
export async function updateServerBuild(
  id: number,
  build: Partial<
    Pick<
      typeof schema.servers.$inferInsert,
      | 'memory'
      | 'swap'
      | 'disk'
      | 'io'
      | 'cpu'
      | 'threads'
      | 'databaseLimit'
      | 'backupLimit'
      | 'allocationLimit'
    >
  >,
) {
  const { server, node } = await loadServer(id)
  await db.update(schema.servers).set(build).where(eq(schema.servers.id, server.id))
  await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/sync`).catch(() => {})
}

/**
 * Picks a node (public, not in maintenance, enough free memory and disk) in
 * one of the given locations, and a free allocation on it.
 */
export async function findDeployment(locationIds: number[], memory: number, disk: number) {
  const nodes = await db.query.nodes.findMany()
  const candidates = nodes.filter(
    (n) => n.public && !n.maintenance && (!locationIds.length || locationIds.includes(n.locationId)),
  )
  const usage = await db
    .select({
      nodeId: schema.servers.nodeId,
      memory: sql<number>`sum(${schema.servers.memory})::int`,
      disk: sql<number>`sum(${schema.servers.disk})::int`,
    })
    .from(schema.servers)
    .groupBy(schema.servers.nodeId)
  const cap = (total: number, over: number) =>
    over < 0 ? Number.POSITIVE_INFINITY : total * (1 + over / 100)
  const ranked = candidates
    .map((n) => {
      const u = usage.find((x) => x.nodeId === n.id)
      return {
        node: n,
        freeMemory: cap(n.memory, n.memoryOverallocate) - (u?.memory ?? 0),
        freeDisk: cap(n.disk, n.diskOverallocate) - (u?.disk ?? 0),
      }
    })
    .filter((c) => c.freeMemory >= memory && c.freeDisk >= disk)
    .sort((a, b) => b.freeMemory - a.freeMemory)
  for (const { node } of ranked) {
    const free = await db.query.allocations.findMany({
      where: and(eq(schema.allocations.nodeId, node.id), isNull(schema.allocations.serverId)),
      limit: 50,
    })
    if (free.length) return { node, allocation: free[Math.floor(Math.random() * free.length)]! }
  }
  throw new HttpError(
    422,
    'No node has enough free resources for this server. Please contact support.',
    'no_capacity',
  )
}
