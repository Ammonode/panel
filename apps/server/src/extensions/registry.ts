import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreEvent, ExtensionApi, ExtensionManifest, ServerExtension } from '@ammonode/sdk'
import { eq } from 'drizzle-orm'
import { config } from '../config'
import { db, schema } from '../db'
import { decrypt, encrypt } from '../lib/crypto'
import { builtinExtensions } from './builtin'

export type LoadedExtension = {
  manifest: ExtensionManifest
  module: ServerExtension
  builtin: boolean
  path: string | null
  enabled: boolean
  settings: Record<string, unknown>
  routeHandler?: (request: Request, path: string) => Response | Promise<Response>
  error?: string
}

const extensions = new Map<string, LoadedExtension>()
const listeners = new Map<CoreEvent, { id: string; fn: (payload: Record<string, unknown>) => unknown }[]>()

const log = (id: string) => ({
  info: (msg: string, data?: unknown) => console.log(`[ext:${id}] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[ext:${id}] ${msg}`, data ?? ''),
})

/** Password settings are stored encrypted. */
function decodeSettings(ext: ServerExtension, raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const field of ext.settings ?? []) {
    const v = raw[field.key]
    if (v === undefined) {
      out[field.key] = 'default' in field ? field.default : undefined
    } else if (field.type === 'password' && typeof v === 'string' && v) {
      try {
        out[field.key] = decrypt(v)
      } catch {
        out[field.key] = ''
      }
    } else {
      out[field.key] = v
    }
  }
  return out
}

export function encodeSettings(
  ext: ServerExtension,
  values: Record<string, unknown>,
  previous: Record<string, unknown>,
) {
  const out: Record<string, unknown> = { ...previous }
  for (const field of ext.settings ?? []) {
    if (!(field.key in values)) continue
    const v = values[field.key]
    // Empty password field = keep the current secret.
    if (field.type === 'password') {
      if (typeof v === 'string' && v !== '') out[field.key] = encrypt(v)
    } else {
      out[field.key] = v
    }
  }
  return out
}

function makeApi(id: string): ExtensionApi {
  return {
    id,
    url: config.url,
    log: log(id),
    async settings() {
      return extensions.get(id)?.settings ?? {}
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), { id, fn }])
    },
    routes(handler) {
      const ext = extensions.get(id)
      if (ext) ext.routeHandler = handler
    },
    schedule(cronExpr, task) {
      import('../services/scheduler').then((s) => s.registerTask(`ext:${id}:${cronExpr}`, cronExpr, task))
    },
    async markInvoicePaid(invoiceId, transaction) {
      const { markInvoicePaid } = await import('../services/billing/invoices')
      await markInvoicePaid(invoiceId, transaction)
    },
    async getInvoice(invoiceId) {
      const { invoiceSummary } = await import('../services/billing/invoices')
      return invoiceSummary(invoiceId)
    },
  }
}

function scanExternal(): { manifest: ExtensionManifest; path: string }[] {
  const dir = join(config.storagePath, 'extensions')
  if (!existsSync(dir)) return []
  const out: { manifest: ExtensionManifest; path: string }[] = []
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'extension.json')
    if (!existsSync(file)) continue
    try {
      out.push({ manifest: JSON.parse(readFileSync(file, 'utf8')), path: join(dir, name) })
    } catch (e) {
      console.error(`Invalid extension manifest ${file}:`, (e as Error).message)
    }
  }
  return out
}

/** Loads built-in and installed extensions and registers the enabled ones. */
export async function loadExtensions() {
  extensions.clear()
  listeners.clear()
  const rows = await db.query.extensions.findMany()
  const candidates: {
    manifest: ExtensionManifest
    module?: ServerExtension
    path: string | null
    builtin: boolean
  }[] = [
    ...builtinExtensions.map((b) => ({ manifest: b.manifest, module: b.module, path: null, builtin: true })),
    ...scanExternal().map((e) => ({ ...e, builtin: false })),
  ]

  for (const c of candidates) {
    const row = rows.find((r) => r.id === c.manifest.id)
    let module = c.module
    let error: string | undefined
    if (!module && c.path && c.manifest.server) {
      try {
        const mod = await import(join(c.path, c.manifest.server))
        module = (mod.default ?? mod) as ServerExtension
      } catch (e) {
        error = (e as Error).message
      }
    }
    module ??= {}
    const ext: LoadedExtension = {
      manifest: c.manifest,
      module,
      builtin: c.builtin,
      path: c.path,
      enabled: !!row?.enabled && !error,
      settings: decodeSettings(module, row?.settings ?? {}),
      error,
    }
    extensions.set(c.manifest.id, ext)
    if (ext.enabled && module.register) {
      try {
        await module.register(makeApi(c.manifest.id))
      } catch (e) {
        ext.error = (e as Error).message
        console.error(`Extension ${c.manifest.id} failed to register:`, e)
      }
    }
  }
}

export const listExtensions = () => [...extensions.values()]
export const getExtension = (id: string) => extensions.get(id)

export function getGateway(id: string) {
  const ext = extensions.get(id)
  return ext?.enabled && ext.module.gateway ? { ext, gateway: ext.module.gateway } : null
}

export function getProvisioner(id: string | null | undefined) {
  if (!id) return null
  const ext = extensions.get(id)
  return ext?.enabled && ext.module.provisioner ? { ext, provisioner: ext.module.provisioner } : null
}

export function enabledGateways() {
  return listExtensions()
    .filter((e) => e.enabled && e.module.gateway)
    .map((e) => ({ id: e.manifest.id, label: e.module.gateway!.label?.(e.settings) ?? e.manifest.name }))
}

/** Fires an event to every extension listening for it; errors are logged, never thrown. */
export async function emit(event: CoreEvent, payload: Record<string, unknown>) {
  for (const l of listeners.get(event) ?? []) {
    try {
      await l.fn(payload)
    } catch (e) {
      console.error(`Extension ${l.id} failed handling ${event}:`, e)
    }
  }
}

export async function saveExtension(
  id: string,
  values: { enabled?: boolean; settings?: Record<string, unknown> },
) {
  const ext = extensions.get(id)
  if (!ext) throw new Error('Extension not found')
  const row = await db.query.extensions.findFirst({ where: eq(schema.extensions.id, id) })
  const settings = values.settings
    ? encodeSettings(ext.module, values.settings, row?.settings ?? {})
    : (row?.settings ?? {})
  const enabled = values.enabled ?? row?.enabled ?? false
  await db
    .insert(schema.extensions)
    .values({ id, type: ext.manifest.type, version: ext.manifest.version, enabled, settings })
    .onConflictDoUpdate({
      target: schema.extensions.id,
      set: { enabled, settings, version: ext.manifest.version },
    })
  await loadExtensions()
}
