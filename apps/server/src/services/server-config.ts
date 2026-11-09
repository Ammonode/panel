import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../db'

type Server = typeof schema.servers.$inferSelect

/** Builds the configuration document the daemon needs to run a server. */
export async function buildServerConfiguration(server: Server) {
  const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, server.eggId) })
  if (!egg) throw new Error(`Egg ${server.eggId} missing for server ${server.uuid}`)
  const parent = egg.configFrom ? await db.query.eggs.findFirst({ where: eq(schema.eggs.id, egg.configFrom) }) : null
  const eggConfig = {
    files: Object.keys(egg.config.files ?? {}).length ? egg.config.files : (parent?.config.files ?? {}),
    startup: egg.config.startup?.done ? egg.config.startup : (parent?.config.startup ?? { done: '' }),
    stop: egg.config.stop || parent?.config.stop || '^C',
  }

  const eggVars = await db.query.eggVariables.findMany({ where: eq(schema.eggVariables.eggId, egg.id), orderBy: asc(schema.eggVariables.sort) })
  const values = await db.query.serverVariables.findMany({ where: eq(schema.serverVariables.serverId, server.id) })
  const environment: Record<string, string> = {}
  for (const v of eggVars) environment[v.envVariable] = values.find((o) => o.variableId === v.id)?.value ?? v.defaultValue

  const allocations = await db.query.allocations.findMany({ where: eq(schema.allocations.serverId, server.id) })
  const primary = allocations.find((a) => a.id === server.allocationId) ?? allocations[0]
  const mappings: Record<string, number[]> = {}
  for (const a of allocations) (mappings[a.ip] ??= []).push(a.port)

  const mountRows = await db
    .select({ source: schema.mounts.source, target: schema.mounts.target, readOnly: schema.mounts.readOnly })
    .from(schema.serverMounts)
    .innerJoin(schema.mounts, eq(schema.mounts.id, schema.serverMounts.mountId))
    .where(eq(schema.serverMounts.serverId, server.id))

  const done = eggConfig.startup.done
  const stop = eggConfig.stop
  return {
    uuid: server.uuid,
    suspended: server.status === 'suspended',
    invocation: server.startup,
    skip_egg_scripts: server.skipScripts,
    environment,
    labels: {},
    build: {
      memory_limit: server.memory,
      swap: server.swap,
      io_weight: server.io,
      cpu_limit: server.cpu,
      threads: server.threads ?? '',
      disk_space: server.disk,
      oom_disabled: server.oomDisabled,
    },
    container: { image: server.image },
    allocations: {
      force_outgoing_ip: egg.forceOutgoingIp,
      default: { ip: primary?.ip ?? '0.0.0.0', port: primary?.port ?? 0 },
      mappings,
    },
    egg: { id: egg.uuid, file_denylist: egg.fileDenylist, features: egg.features },
    mounts: mountRows.map((m) => ({ source: m.source, target: m.target, read_only: m.readOnly })),
    process_configuration: {
      startup: { done: (Array.isArray(done) ? done : [done]).filter(Boolean), user_interaction: [], strip_ansi: false },
      stop: stop === '^C' || stop === '^^C' ? { type: 'signal', value: 'SIGINT' } : { type: 'command', value: stop },
      configs: Object.entries(eggConfig.files ?? {}).map(([file, def]) => ({
        file,
        parser: def.parser,
        replace: Object.entries(def.find ?? {}).map(([match, value]) => ({ match, replace_with: value })),
      })),
    },
    crash_restart: server.crashRestart,
  }
}

export async function installScript(server: Server) {
  const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, server.eggId) })
  const source = egg?.copyScriptFrom ? await db.query.eggs.findFirst({ where: eq(schema.eggs.id, egg.copyScriptFrom) }) : egg
  return {
    container_image: source?.scriptContainer ?? 'alpine:3.4',
    entrypoint: source?.scriptEntry ?? 'ash',
    script: source?.scriptInstall ?? '',
  }
}

