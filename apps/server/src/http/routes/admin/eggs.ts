import { and, count, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { logActivity } from '../../../lib/activity'
import { HttpError, notFound } from '../../../lib/errors'
import { daemonRequest } from '../../../services/daemon'
import { clientIp, newUuid, requirePermission } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import { onlyProvided, validate } from '../../validate'

const jsonObject = z.record(z.string(), z.unknown())
const eggBody = z.object({
  name: z.string().min(1).max(191),
  description: z.string().nullish(),
  author: z.string().min(1).max(191),
  startup: z.string().min(1),
  dockerImages: z
    .record(z.string(), z.string().min(1))
    .refine((v) => Object.keys(v).length > 0, 'Add at least one docker image'),
  features: z.array(z.string().max(64)).max(20),
  fileDenylist: z.array(z.string().max(191)).max(100),
  forceOutgoingIp: z.boolean(),
  config: z.object({
    // Parsers the daemon understands; each file maps setting -> value.
    files: z.record(
      z.string().min(1),
      z.object({
        parser: z.enum(['properties', 'file', 'json', 'yaml', 'yml', 'ini', 'xml']),
        find: jsonObject,
      }),
    ),
    startup: z.object({ done: z.union([z.string(), z.array(z.string())]) }).passthrough(),
    logs: jsonObject,
    stop: z.string().min(1),
  }),
  scriptContainer: z.string().min(1).max(191),
  scriptEntry: z.string().min(1).max(191),
  scriptInstall: z.string().nullish(),
  scriptIsPrivileged: z.boolean(),
})

const variableBody = z.object({
  name: z.string().min(1).max(191),
  description: z.string().max(2000).default(''),
  envVariable: z
    .string()
    .min(1)
    .max(191)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Use UPPER_CASE letters, numbers and underscores'),
  defaultValue: z.string().max(4096).default(''),
  userViewable: z.boolean().default(true),
  userEditable: z.boolean().default(true),
  rules: z.string().max(512).default('nullable|string'),
})

// Variables reserved by the daemon/runtime that eggs may not define.
const RESERVED = [
  'SERVER_MEMORY',
  'SERVER_IP',
  'SERVER_PORT',
  'ENV',
  'HOME',
  'USER',
  'STARTUP',
  'SERVER_UUID',
  'UUID',
  'TZ',
  'P_SERVER_UUID',
  'P_SERVER_ALLOCATION_LIMIT',
]

const intId = (v: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw notFound()
  return n
}

export const adminEggRoutes = new Hono<AppEnv>()
  .post('/nests/:id/eggs', requirePermission('admin.nests.manage'), validate('json', eggBody), async (c) => {
    const nestId = intId(c.req.param('id'))
    if (!(await db.query.nests.findFirst({ where: eq(schema.nests.id, nestId) }))) throw notFound('Nest')
    const [egg] = await db
      .insert(schema.eggs)
      .values({ ...c.req.valid('json'), nestId, uuid: newUuid() })
      .returning()
    await logActivity({
      event: 'admin:egg.create',
      actorId: c.get('user')!.id,
      ip: clientIp(c),
      subject: { type: 'egg', id: egg!.id },
    })
    return c.json({ data: egg }, 201)
  })
  .patch(
    '/eggs/:id',
    requirePermission('admin.nests.manage'),
    validate('json', eggBody.partial().extend({ nestId: z.number().int().optional() })),
    async (c) => {
      const id = intId(c.req.param('id'))
      const body = await onlyProvided(c, c.req.valid('json'))
      const [egg] = await db.update(schema.eggs).set(body).where(eq(schema.eggs.id, id)).returning()
      if (!egg) throw notFound('Egg')
      // Servers of this egg follow the nest too.
      if (body.nestId)
        await db.update(schema.servers).set({ nestId: body.nestId }).where(eq(schema.servers.eggId, id))
      await logActivity({
        event: 'admin:egg.update',
        actorId: c.get('user')!.id,
        ip: clientIp(c),
        subject: { type: 'egg', id },
      })
      return c.json({ data: egg })
    },
  )
  .post(
    '/eggs/:id/variables',
    requirePermission('admin.nests.manage'),
    validate('json', variableBody),
    async (c) => {
      const eggId = intId(c.req.param('id'))
      const v = c.req.valid('json')
      if (RESERVED.includes(v.envVariable))
        throw new HttpError(422, `${v.envVariable} is reserved`, 'invalid', { envVariable: 'Reserved name' })
      const dup = await db.query.eggVariables.findFirst({
        where: and(eq(schema.eggVariables.eggId, eggId), eq(schema.eggVariables.envVariable, v.envVariable)),
      })
      if (dup) throw new HttpError(409, 'This egg already has that variable', 'conflict')
      const [{ n }] = (await db
        .select({ n: count() })
        .from(schema.eggVariables)
        .where(eq(schema.eggVariables.eggId, eggId))) as [{ n: number }]
      const [row] = await db
        .insert(schema.eggVariables)
        .values({ ...v, eggId, sort: n })
        .returning()
      return c.json({ data: row }, 201)
    },
  )
  .patch(
    '/eggs/:id/variables/:variable',
    requirePermission('admin.nests.manage'),
    validate('json', variableBody.partial()),
    async (c) => {
      const body = await onlyProvided(c, c.req.valid('json'))
      if (body.envVariable && RESERVED.includes(body.envVariable))
        throw new HttpError(422, `${body.envVariable} is reserved`, 'invalid')
      const [row] = await db
        .update(schema.eggVariables)
        .set(body)
        .where(
          and(
            eq(schema.eggVariables.id, intId(c.req.param('variable'))),
            eq(schema.eggVariables.eggId, intId(c.req.param('id'))),
          ),
        )
        .returning()
      if (!row) throw notFound('Variable')
      return c.json({ data: row })
    },
  )
  .delete('/eggs/:id/variables/:variable', requirePermission('admin.nests.manage'), async (c) => {
    // Server values for this variable are removed with it (cascade).
    await db
      .delete(schema.eggVariables)
      .where(
        and(
          eq(schema.eggVariables.id, intId(c.req.param('variable'))),
          eq(schema.eggVariables.eggId, intId(c.req.param('id'))),
        ),
      )
    return c.json({ ok: true })
  })

export const adminNodeExtraRoutes = new Hono<AppEnv>()
  // Live info from the daemon (version, docker, memory) or why it is unreachable.
  .get('/nodes/:id/system', requirePermission('admin.nodes.manage'), async (c) => {
    const node = await db.query.nodes.findFirst({ where: eq(schema.nodes.id, intId(c.req.param('id'))) })
    if (!node) throw notFound('Node')
    try {
      const info = await daemonRequest<Record<string, string | number>>(node, 'GET', '/api/system')
      return c.json({ data: info, online: true })
    } catch (e) {
      return c.json({ data: null, online: false, error: (e as Error).message })
    }
  })
  .patch(
    '/nodes/:id/allocations/:allocation',
    requirePermission('admin.nodes.manage'),
    validate(
      'json',
      z.object({ ipAlias: z.string().max(191).nullable(), notes: z.string().max(256).nullable() }).partial(),
    ),
    async (c) => {
      const values: { ipAlias?: string | null; notes?: string | null } = await onlyProvided(
        c,
        c.req.valid('json'),
      )
      const [row] = await db
        .update(schema.allocations)
        .set(values)
        .where(
          and(
            eq(schema.allocations.id, intId(c.req.param('allocation'))),
            eq(schema.allocations.nodeId, intId(c.req.param('id'))),
          ),
        )
        .returning()
      if (!row) throw notFound('Allocation')
      return c.json({ data: row })
    },
  )
