import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { HttpError, notFound } from '../../../lib/errors'
import { daemonRequest } from '../../../services/daemon'
import { validateVariable } from '../../../services/servers'
import { clientIp, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { onlyProvided, validate } from '../../validate'

async function load(idParam: string) {
  const id = Number(idParam)
  const server = Number.isInteger(id)
    ? await db.query.servers.findFirst({ where: eq(schema.servers.id, id) })
    : undefined
  if (!server) throw notFound('Server')
  const node = (await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) }))!
  return { server, node }
}

const buildBody = z
  .object({
    memory: z.number().int().min(0),
    swap: z.number().int().min(-1),
    disk: z.number().int().min(0),
    io: z.number().int().min(10).max(1000),
    cpu: z.number().int().min(0),
    threads: z
      .string()
      .regex(/^[0-9,-]*$/)
      .nullable(),
    oomDisabled: z.boolean(),
    databaseLimit: z.number().int().min(0),
    allocationLimit: z.number().int().min(0),
    backupLimit: z.number().int().min(0),
    allocationId: z.number().int(),
    addAllocations: z.array(z.number().int()),
    removeAllocations: z.array(z.number().int()),
  })
  .partial()

export const adminServerEditRoutes = new Hono<AppEnv>()
  .get('/servers/:id', requirePermission('admin.servers.view'), async (c) => {
    const { server, node } = await load(c.req.param('id'))
    const owner = await db.query.users.findFirst({
      where: eq(schema.users.id, server.ownerId),
      columns: { id: true, email: true, username: true },
    })
    const allocations = await db.query.allocations.findMany({
      where: eq(schema.allocations.serverId, server.id),
      orderBy: asc(schema.allocations.port),
    })
    const variables = await db.query.eggVariables.findMany({
      where: eq(schema.eggVariables.eggId, server.eggId),
      orderBy: asc(schema.eggVariables.sort),
    })
    const values = await db.query.serverVariables.findMany({
      where: eq(schema.serverVariables.serverId, server.id),
    })
    const egg = await db.query.eggs.findFirst({
      where: eq(schema.eggs.id, server.eggId),
      columns: { id: true, name: true, dockerImages: true, startup: true },
    })
    return c.json({
      data: {
        ...server,
        owner,
        node: { id: node.id, name: node.name },
        egg,
        allocations,
        variables: variables.map((v) => ({
          envVariable: v.envVariable,
          name: v.name,
          description: v.description,
          rules: v.rules,
          value: values.find((x) => x.variableId === v.id)?.value ?? v.defaultValue,
        })),
      },
    })
  })
  .patch(
    '/servers/:id/details',
    requirePermission('admin.servers.manage'),
    validate(
      'json',
      z
        .object({
          name: z.string().min(1).max(191),
          description: z.string().nullish(),
          ownerId: z.number().int(),
          externalId: z.string().max(191).nullish(),
        })
        .partial(),
    ),
    async (c) => {
      const { server } = await load(c.req.param('id'))
      const body = await onlyProvided(c, c.req.valid('json'))
      if (body.ownerId && !(await db.query.users.findFirst({ where: eq(schema.users.id, body.ownerId) })))
        throw new HttpError(422, 'Owner not found', 'invalid')
      await db.update(schema.servers).set(body).where(eq(schema.servers.id, server.id))
      // The new owner should not also be a subuser.
      if (body.ownerId)
        await db
          .delete(schema.subusers)
          .where(and(eq(schema.subusers.serverId, server.id), eq(schema.subusers.userId, body.ownerId)))
      await logActivity({
        event: 'admin:server.details',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'server', id: server.id },
        properties: body,
      })
      return c.json({ ok: true })
    },
  )
  .patch(
    '/servers/:id/build',
    requirePermission('admin.servers.manage'),
    validate('json', buildBody),
    async (c) => {
      const { server, node } = await load(c.req.param('id'))
      const {
        addAllocations = [],
        removeAllocations = [],
        ...build
      } = await onlyProvided(c, c.req.valid('json'))
      await db.transaction(async (tx) => {
        for (const id of addAllocations) {
          const claimed = await tx
            .update(schema.allocations)
            .set({ serverId: server.id })
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
        const primary = build.allocationId ?? server.allocationId
        if (removeAllocations.includes(primary))
          throw new HttpError(422, 'You cannot remove the primary allocation', 'invalid')
        if (removeAllocations.length) {
          await tx
            .update(schema.allocations)
            .set({ serverId: null, notes: null })
            .where(
              and(
                eq(schema.allocations.serverId, server.id),
                inArray(schema.allocations.id, removeAllocations),
              ),
            )
        }
        if (build.allocationId) {
          const own = await tx.query.allocations.findFirst({
            where: and(
              eq(schema.allocations.id, build.allocationId),
              eq(schema.allocations.serverId, server.id),
            ),
          })
          if (!own) throw new HttpError(422, 'The primary allocation must belong to this server', 'invalid')
        }
        if (Object.keys(build).length)
          await tx.update(schema.servers).set(build).where(eq(schema.servers.id, server.id))
      })
      await daemonRequest(node, 'POST', `/api/servers/${server.uuid}/sync`).catch(() => {})
      await logActivity({
        event: 'admin:server.build',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'server', id: server.id },
        properties: { ...build, addAllocations, removeAllocations },
      })
      return c.json({ ok: true, note: 'Resource changes apply the next time the server restarts.' })
    },
  )
  .patch(
    '/servers/:id/startup',
    requirePermission('admin.servers.manage'),
    validate(
      'json',
      z
        .object({
          startup: z.string().min(1),
          image: z.string().min(1).max(191),
          eggId: z.number().int(),
          skipScripts: z.boolean(),
          environment: z.record(z.string(), z.string()),
        })
        .partial(),
    ),
    async (c) => {
      const { server } = await load(c.req.param('id'))
      const body = await onlyProvided(c, c.req.valid('json'))
      const eggId = body.eggId ?? server.eggId
      const eggChanged = eggId !== server.eggId
      const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, eggId) })
      if (!egg) throw new HttpError(422, 'Egg not found', 'invalid')
      const variables = await db.query.eggVariables.findMany({ where: eq(schema.eggVariables.eggId, egg.id) })
      const current = eggChanged
        ? []
        : await db.query.serverVariables.findMany({ where: eq(schema.serverVariables.serverId, server.id) })
      const errors: Record<string, string> = {}
      const values = variables.map((v) => {
        const value =
          body.environment?.[v.envVariable] ??
          current.find((x) => x.variableId === v.id)?.value ??
          v.defaultValue
        // Variable rules still apply to admins: they protect against servers that cannot boot.
        const err = validateVariable(v.rules, value)
        if (err) errors[`environment.${v.envVariable}`] = `${v.name} ${err}`
        return { variableId: v.id, value }
      })
      if (Object.keys(errors).length) throw new HttpError(422, 'Invalid server variables', 'invalid', errors)
      await db.transaction(async (tx) => {
        await tx
          .update(schema.servers)
          .set({
            eggId: egg.id,
            nestId: egg.nestId,
            startup: body.startup ?? (eggChanged ? egg.startup : server.startup),
            image:
              body.image ??
              (eggChanged ? (Object.values(egg.dockerImages)[0] ?? server.image) : server.image),
            ...(body.skipScripts !== undefined ? { skipScripts: body.skipScripts } : {}),
          })
          .where(eq(schema.servers.id, server.id))
        await tx.delete(schema.serverVariables).where(eq(schema.serverVariables.serverId, server.id))
        if (values.length)
          await tx.insert(schema.serverVariables).values(values.map((v) => ({ ...v, serverId: server.id })))
      })
      await logActivity({
        event: 'admin:server.startup',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'server', id: server.id },
        properties: { eggId: egg.id },
      })
      return c.json({ ok: true, eggChanged })
    },
  )
