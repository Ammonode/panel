import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db'
import { logActivity } from '../lib/activity'
import { HttpError } from '../lib/errors'
import { daemonRequest, signDaemonToken } from './daemon'

/**
 * Moves a server to another node. The target is prepared first, then the
 * source streams an archive to it. The server only switches nodes once the
 * target confirms; any failure leaves it on the original node.
 */
export async function startTransfer(
  serverId: number,
  newNodeId: number,
  newAllocationId: number,
  actorId: number,
) {
  const server = await db.query.servers.findFirst({ where: eq(schema.servers.id, serverId) })
  if (!server) throw new HttpError(404, 'Server not found', 'not_found')
  if (server.status)
    throw new HttpError(422, `The server is ${server.status.replace('_', ' ')}; try again later`, 'invalid')
  if (server.nodeId === newNodeId) throw new HttpError(422, 'The server is already on that node', 'invalid')
  const [oldNode, newNode] = await Promise.all([
    db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) }),
    db.query.nodes.findFirst({ where: eq(schema.nodes.id, newNodeId) }),
  ])
  if (!oldNode || !newNode) throw new HttpError(422, 'Node not found', 'invalid')

  const used = await db.query.servers.findMany({
    where: eq(schema.servers.nodeId, newNode.id),
    columns: { memory: true, disk: true },
  })
  const cap = (total: number, over: number) =>
    over < 0 ? Number.POSITIVE_INFINITY : total * (1 + over / 100)
  const memory = used.reduce((t, s) => t + s.memory, 0) + server.memory
  const disk = used.reduce((t, s) => t + s.disk, 0) + server.disk
  if (
    memory > cap(newNode.memory, newNode.memoryOverallocate) ||
    disk > cap(newNode.disk, newNode.diskOverallocate)
  ) {
    throw new HttpError(
      422,
      'The target node does not have enough memory or disk for this server',
      'node_full',
    )
  }

  const oldAllocations = await db.query.allocations.findMany({
    where: eq(schema.allocations.serverId, server.id),
  })
  // Reserve the new primary port and mark the server as transferring.
  const transfer = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.allocations)
      .set({ serverId: server.id })
      .where(
        and(
          eq(schema.allocations.id, newAllocationId),
          eq(schema.allocations.nodeId, newNode.id),
          isNull(schema.allocations.serverId),
        ),
      )
      .returning()
    if (!claimed.length) throw new HttpError(422, 'That port is not free on the target node', 'invalid')
    await tx.update(schema.servers).set({ status: 'transferring' }).where(eq(schema.servers.id, server.id))
    const [t] = await tx
      .insert(schema.serverTransfers)
      .values({
        serverId: server.id,
        oldNodeId: oldNode.id,
        newNodeId: newNode.id,
        oldAllocationIds: oldAllocations.map((a) => a.id),
        newAllocationId,
      })
      .returning()
    return t!
  })

  try {
    await daemonRequest(newNode, 'POST', '/api/transfers', { server_uuid: server.uuid })
    const token = await signDaemonToken(newNode, { server_uuid: server.uuid, transfer: true }, 12 * 3600)
    await daemonRequest(oldNode, 'POST', `/api/servers/${server.uuid}/transfer`, {
      url: `${newNode.scheme}://${newNode.fqdn}:${newNode.daemonListen}/api/transfers/receive`,
      token,
    })
  } catch (e) {
    await finishTransfer(server.uuid, false, (e as Error).message)
    throw e
  }
  await logActivity({
    event: 'admin:server.transfer',
    actorId,
    subject: { type: 'server', id: server.id },
    properties: { from: oldNode.name, to: newNode.name },
  })
  return transfer
}

export async function activeTransfer(serverId: number) {
  return db.query.serverTransfers.findFirst({
    where: and(eq(schema.serverTransfers.serverId, serverId), isNull(schema.serverTransfers.successful)),
  })
}

/** Called when the target (or the source, on failure) reports back. */
export async function finishTransfer(serverUuid: string, successful: boolean, error?: string) {
  const server = await db.query.servers.findFirst({ where: eq(schema.servers.uuid, serverUuid) })
  if (!server) return
  const transfer = await activeTransfer(server.id)
  if (!transfer) return
  const [oldNode, newNode] = await Promise.all([
    db.query.nodes.findFirst({ where: eq(schema.nodes.id, transfer.oldNodeId) }),
    db.query.nodes.findFirst({ where: eq(schema.nodes.id, transfer.newNodeId) }),
  ])

  if (successful) {
    await db.transaction(async (tx) => {
      // Ports of the old node are released; the reserved port becomes primary.
      for (const id of transfer.oldAllocationIds)
        await tx
          .update(schema.allocations)
          .set({ serverId: null, notes: null })
          .where(eq(schema.allocations.id, id))
      await tx
        .update(schema.servers)
        .set({ nodeId: transfer.newNodeId, allocationId: transfer.newAllocationId, status: null })
        .where(eq(schema.servers.id, server.id))
      await tx
        .update(schema.serverTransfers)
        .set({ successful: true })
        .where(eq(schema.serverTransfers.id, transfer.id))
    })
    if (newNode) await daemonRequest(newNode, 'POST', `/api/servers/${server.uuid}/sync`).catch(() => {})
    if (oldNode)
      await daemonRequest(oldNode, 'DELETE', `/api/servers/${server.uuid}`).catch((e) =>
        console.error('could not remove transferred server from old node:', e.message),
      )
  } else {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.allocations)
        .set({ serverId: null })
        .where(
          and(
            eq(schema.allocations.id, transfer.newAllocationId),
            eq(schema.allocations.serverId, server.id),
          ),
        )
      await tx.update(schema.servers).set({ status: null }).where(eq(schema.servers.id, server.id))
      await tx
        .update(schema.serverTransfers)
        .set({ successful: false, error: error ?? 'unknown error' })
        .where(eq(schema.serverTransfers.id, transfer.id))
    })
    // Remove the partial copy from the target; the original stays untouched.
    if (newNode) await daemonRequest(newNode, 'DELETE', `/api/servers/${server.uuid}`).catch(() => {})
  }
  await logActivity({
    event: successful ? 'server:transfer.success' : 'server:transfer.failed',
    subject: { type: 'server', id: server.id },
    properties: error ? { error } : {},
  })
}
