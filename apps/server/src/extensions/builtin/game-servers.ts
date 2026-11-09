import type { ExtensionManifest, ServerExtension, ServiceContext, SettingField } from '@ammonode/sdk'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import {
  createServer,
  deleteServer,
  findDeployment,
  setServerSuspended,
  updateServerBuild,
} from '../../services/servers'

export const manifest: ExtensionManifest = {
  id: 'game-servers',
  name: 'Game Servers',
  type: 'server',
  version: '1.0.0',
  description: 'Creates game servers on your Ammonode nodes when a product is ordered.',
  author: 'Ammonode',
  ammonode: '*',
}

const RESOURCE_KEYS = ['memory', 'swap', 'disk', 'cpu', 'io', 'databases', 'backups', 'allocations'] as const

/**
 * Product settings with config option overrides. A config option whose
 * environment variable is `memory`, `disk`, ... replaces that limit; any other
 * environment variable is passed to the egg (e.g. MINECRAFT_VERSION).
 */
function resolve(ctx: ServiceContext) {
  const s = ctx.product.settings
  const o = ctx.configOptions
  const num = (key: string, fallback: number) => {
    const v = o[key] ?? s[key]
    const n = Number(v)
    return v === undefined || v === '' || Number.isNaN(n) ? fallback : n
  }
  const environment: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    // Empty answers keep the egg default instead of overriding it with ''.
    if (
      v !== '' &&
      !(RESOURCE_KEYS as readonly string[]).includes(k) &&
      k !== 'location' &&
      /^[A-Z0-9_]+$/.test(k)
    )
      environment[k] = v
  }
  const location = o.location ?? s.location
  return {
    eggId: Number(s.egg),
    locationIds: location && location !== 'any' ? [Number(location)] : [],
    memory: num('memory', 1024),
    swap: num('swap', 0),
    disk: num('disk', 5120),
    cpu: num('cpu', 100),
    io: num('io', 500),
    databases: num('databases', 0),
    backups: num('backups', 0),
    allocations: num('allocations', 0),
    startOnCompletion: s.start_on_completion !== false,
    environment,
  }
}

const serverIdOf = (ctx: ServiceContext) => {
  const id = Number(ctx.service.properties.serverId)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function serverExists(id: number | null) {
  return !!id && !!(await db.query.servers.findFirst({ where: eq(schema.servers.id, id) }))
}

export const extension: ServerExtension = {
  provisioner: {
    async productSettings(): Promise<SettingField[]> {
      const eggs = await db.query.eggs.findMany({ columns: { id: true, name: true } })
      const locations = await db.query.locations.findMany()
      return [
        {
          key: 'egg',
          label: 'Egg',
          type: 'select',
          options: eggs.map((e) => ({ value: String(e.id), label: e.name })),
        },
        {
          key: 'location',
          label: 'Location',
          type: 'select',
          default: 'any',
          options: [
            { value: 'any', label: 'Any location' },
            ...locations.map((l) => ({
              value: String(l.id),
              label: l.long ? `${l.short} (${l.long})` : l.short,
            })),
          ],
          description: 'Can be overridden by a config option with the environment variable "location".',
        },
        { key: 'memory', label: 'Memory (MiB)', type: 'number', default: 1024, min: 0 },
        { key: 'swap', label: 'Swap (MiB)', type: 'number', default: 0, min: -1 },
        { key: 'disk', label: 'Disk (MiB)', type: 'number', default: 5120, min: 0 },
        {
          key: 'cpu',
          label: 'CPU limit (%)',
          type: 'number',
          default: 100,
          min: 0,
          description: '100 = one core, 0 = unlimited.',
        },
        { key: 'io', label: 'Block IO weight', type: 'number', default: 500, min: 10, max: 1000 },
        { key: 'databases', label: 'Databases', type: 'number', default: 0, min: 0 },
        { key: 'backups', label: 'Backups', type: 'number', default: 0, min: 0 },
        { key: 'allocations', label: 'Extra ports', type: 'number', default: 0, min: 0 },
        { key: 'start_on_completion', label: 'Start after install', type: 'boolean', default: true },
      ]
    },

    async create(ctx) {
      // Retried activation after a failure: do not create a second server.
      if (await serverExists(serverIdOf(ctx))) return
      const r = resolve(ctx)
      if (!r.eggId) throw new Error(`Product "${ctx.product.name}" has no egg configured`)
      const { node, allocation } = await findDeployment(r.locationIds, r.memory, r.disk)
      const server = await createServer({
        name: ctx.checkoutConfig.server_name || `${ctx.product.name} #${ctx.service.id}`,
        ownerId: ctx.user.id,
        eggId: r.eggId,
        nodeId: node.id,
        allocationId: allocation.id,
        memory: r.memory,
        swap: r.swap,
        disk: r.disk,
        cpu: r.cpu,
        io: r.io,
        databaseLimit: r.databases,
        backupLimit: r.backups,
        allocationLimit: r.allocations,
        environment: r.environment,
        startOnCompletion: r.startOnCompletion,
        externalId: `service-${ctx.service.id}`,
      })
      return { serverId: server.id, serverUuid: server.uuid, serverIdentifier: server.uuidShort }
    },

    async suspend(ctx) {
      const id = serverIdOf(ctx)
      if (await serverExists(id)) await setServerSuspended(id!, true)
    },
    async unsuspend(ctx) {
      const id = serverIdOf(ctx)
      if (await serverExists(id)) await setServerSuspended(id!, false)
    },
    async terminate(ctx) {
      const id = serverIdOf(ctx)
      if (await serverExists(id)) await deleteServer(id!, true)
    },
    async upgrade(ctx) {
      const id = serverIdOf(ctx)
      if (!(await serverExists(id))) return
      const r = resolve(ctx)
      await updateServerBuild(id!, {
        memory: r.memory,
        swap: r.swap,
        disk: r.disk,
        cpu: r.cpu,
        io: r.io,
        databaseLimit: r.databases,
        backupLimit: r.backups,
        allocationLimit: r.allocations,
      })
    },
    async loginUrl(ctx) {
      const identifier = ctx.service.properties.serverIdentifier
      return typeof identifier === 'string' ? `/server/${identifier}` : null
    },
    checkoutFields: () => [
      { key: 'server_name', label: 'Server name', type: 'text', description: 'You can change this later.' },
    ],
  },
}
