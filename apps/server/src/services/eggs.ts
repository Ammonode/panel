import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import type { EggConfig } from '../db/schema'
import { HttpError } from '../lib/errors'

/** Accepts both PTDL_v1 and PTDL_v2 exports from Pterodactyl (and our own exports). */
const eggFile = z.object({
  meta: z.object({ version: z.enum(['PTDL_v1', 'PTDL_v2']), update_url: z.string().nullish() }),
  name: z.string(),
  author: z.string(),
  uuid: z.string().optional(),
  description: z.string().nullish(),
  features: z.array(z.string()).nullish(),
  docker_images: z.record(z.string(), z.string()).optional(),
  images: z.array(z.string()).optional(),
  file_denylist: z.array(z.string()).nullish(),
  startup: z.string(),
  config: z.object({
    files: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
    startup: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
    logs: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
    stop: z.string().nullish(),
  }),
  scripts: z
    .object({
      installation: z
        .object({
          script: z.string().nullish(),
          container: z.string().nullish(),
          entrypoint: z.string().nullish(),
        })
        .optional(),
    })
    .optional(),
  variables: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().nullish(),
        env_variable: z.string(),
        default_value: z.union([z.string(), z.number()]).nullish(),
        user_viewable: z.union([z.boolean(), z.number()]).nullish(),
        user_editable: z.union([z.boolean(), z.number()]).nullish(),
        rules: z.union([z.string(), z.array(z.string())]).nullish(),
        field_type: z.string().nullish(),
      }),
    )
    .default([]),
})

export type EggFile = z.infer<typeof eggFile>

const parseJsonField = (v: unknown, fallback: unknown) => {
  if (v == null || v === '') return fallback
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    throw new HttpError(422, 'Egg contains an invalid JSON config block', 'invalid_egg')
  }
}

export function parseEgg(input: unknown) {
  const res = eggFile.safeParse(typeof input === 'string' ? JSON.parse(input) : input)
  if (!res.success)
    throw new HttpError(
      422,
      'This file is not a valid Pterodactyl egg (PTDL_v1/PTDL_v2).',
      'invalid_egg',
      res.error.issues,
    )
  const egg = res.data
  const dockerImages = egg.docker_images ?? Object.fromEntries((egg.images ?? []).map((i) => [i, i]))
  const config: EggConfig = {
    files: parseJsonField(egg.config.files, {}) as EggConfig['files'],
    startup: parseJsonField(egg.config.startup, { done: '' }) as EggConfig['startup'],
    logs: parseJsonField(egg.config.logs, {}) as EggConfig['logs'],
    stop: egg.config.stop ?? '^C',
  }
  const install = egg.scripts?.installation
  return {
    egg: {
      name: egg.name,
      author: egg.author,
      description: egg.description ?? null,
      features: egg.features ?? [],
      dockerImages,
      fileDenylist: egg.file_denylist ?? [],
      updateUrl: egg.meta.update_url ?? null,
      startup: egg.startup,
      config,
      scriptContainer: install?.container ?? 'alpine:3.4',
      scriptEntry: install?.entrypoint ?? 'ash',
      scriptInstall: (install?.script ?? '').replace(/\r\n/g, '\n'),
    },
    variables: egg.variables.map((v, i) => ({
      name: v.name,
      description: v.description ?? '',
      envVariable: v.env_variable,
      defaultValue: v.default_value == null ? '' : String(v.default_value),
      userViewable: !!v.user_viewable,
      userEditable: !!v.user_editable,
      rules: Array.isArray(v.rules) ? v.rules.join('|') : (v.rules ?? ''),
      sort: i,
    })),
  }
}

/** Imports an egg into a nest; when `updateEggId` is given the egg is updated in place keeping server values. */
export async function importEgg(
  nestId: number,
  input: unknown,
  opts: { updateEggId?: number; sourceUrl?: string } = {},
) {
  const { egg, variables } = parseEgg(input)
  return db.transaction(async (tx) => {
    let eggId: number
    if (opts.updateEggId) {
      eggId = opts.updateEggId
      await tx
        .update(schema.eggs)
        .set({ ...egg, sourceUrl: opts.sourceUrl })
        .where(eq(schema.eggs.id, eggId))
      const existing = await tx.query.eggVariables.findMany({ where: eq(schema.eggVariables.eggId, eggId) })
      for (const v of variables) {
        const match = existing.find((e) => e.envVariable === v.envVariable)
        if (match) await tx.update(schema.eggVariables).set(v).where(eq(schema.eggVariables.id, match.id))
        else await tx.insert(schema.eggVariables).values({ ...v, eggId })
      }
      for (const e of existing) {
        if (!variables.some((v) => v.envVariable === e.envVariable)) {
          await tx.delete(schema.eggVariables).where(and(eq(schema.eggVariables.id, e.id)))
        }
      }
    } else {
      const [row] = await tx
        .insert(schema.eggs)
        .values({ ...egg, nestId, uuid: crypto.randomUUID(), sourceUrl: opts.sourceUrl })
        .returning({ id: schema.eggs.id })
      eggId = row!.id
      if (variables.length)
        await tx.insert(schema.eggVariables).values(variables.map((v) => ({ ...v, eggId })))
    }
    return eggId
  })
}

export async function exportEgg(eggId: number) {
  const egg = await db.query.eggs.findFirst({ where: eq(schema.eggs.id, eggId) })
  if (!egg) throw new HttpError(404, 'Egg not found', 'not_found')
  const variables = await db.query.eggVariables.findMany({
    where: eq(schema.eggVariables.eggId, eggId),
    orderBy: schema.eggVariables.sort,
  })
  return {
    _comment: 'Exported from Ammonode. Compatible with Pterodactyl PTDL_v2.',
    meta: { version: 'PTDL_v2', update_url: egg.updateUrl },
    exported_at: new Date().toISOString(),
    name: egg.name,
    author: egg.author,
    description: egg.description,
    features: egg.features,
    docker_images: egg.dockerImages,
    file_denylist: egg.fileDenylist,
    startup: egg.startup,
    config: {
      files: JSON.stringify(egg.config.files, null, 4),
      startup: JSON.stringify(egg.config.startup, null, 4),
      logs: JSON.stringify(egg.config.logs, null, 4),
      stop: egg.config.stop,
    },
    scripts: {
      installation: {
        script: egg.scriptInstall,
        container: egg.scriptContainer,
        entrypoint: egg.scriptEntry,
      },
    },
    variables: variables.map((v) => ({
      name: v.name,
      description: v.description,
      env_variable: v.envVariable,
      default_value: v.defaultValue,
      user_viewable: v.userViewable,
      user_editable: v.userEditable,
      rules: v.rules,
      field_type: 'text',
    })),
  }
}
