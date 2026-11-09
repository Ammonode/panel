import { inArray } from 'drizzle-orm'
import { db, schema } from '../db'

/** Default values for every core setting. Extensions register theirs under `ext.<id>.*`. */
export const defaultSettings = {
  'app.name': 'Ammonode',
  'app.logo': null as string | null,
  'app.theme': 'default',
  'app.language': 'en',
  'auth.registration': true,
  'auth.require_email_verification': false,
  'auth.require_2fa_admins': false,
  'billing.currency': 'USD',
  'billing.invoice_number_format': 'INV-{number}',
  'billing.invoice_number_padding': 5,
  'billing.invoice_days_before_due': 7,
  'billing.reminder_days_before_due': 3,
  'billing.suspend_after_days': 2,
  'billing.terminate_after_days': 14,
  'billing.cancel_pending_orders_after_days': 7,
  'billing.credits_enabled': true,
  'billing.credits_min_deposit': 5,
  'billing.credits_max_deposit': 1000,
  'billing.tax_enabled': false,
  'billing.tax_type': 'exclusive' as 'inclusive' | 'exclusive',
  'affiliates.enabled': false,
  'affiliates.reward_percent': 10,
  'tickets.enabled': true,
  'servers.allow_client_create': false,
}

export type SettingKey = keyof typeof defaultSettings

let cache: Map<string, unknown> | null = null

async function load() {
  if (cache) return cache
  const rows = await db.select().from(schema.settings)
  cache = new Map(rows.map((r) => [r.key, r.value]))
  return cache
}

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof defaultSettings)[K]> {
  const all = await load()
  return (all.has(key) ? all.get(key) : defaultSettings[key]) as (typeof defaultSettings)[K]
}

export async function getSettings(keys?: string[]): Promise<Record<string, unknown>> {
  const all = await load()
  const list = keys ?? [...new Set([...Object.keys(defaultSettings), ...all.keys()])]
  return Object.fromEntries(
    list.map((k) => [k, all.has(k) ? all.get(k) : ((defaultSettings as Record<string, unknown>)[k] ?? null)]),
  )
}

export async function setSettings(values: Record<string, unknown>) {
  const entries = Object.entries(values)
  if (!entries.length) return
  await db.transaction(async (tx) => {
    await tx.delete(schema.settings).where(
      inArray(
        schema.settings.key,
        entries.map(([k]) => k),
      ),
    )
    await tx.insert(schema.settings).values(entries.map(([key, value]) => ({ key, value })))
  })
  cache = null
}
