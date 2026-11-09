import { resolve } from 'node:path'
import { z } from 'zod'

const env = z
  .object({
    APP_URL: z.string().url().default('http://localhost:3000'),
    APP_PORT: z.coerce.number().default(3000),
    APP_KEY: z.string().min(32, 'APP_KEY is missing, run `ammonode key:generate`'),
    APP_ENV: z.enum(['production', 'development', 'test']).default('production'),
    APP_TIMEZONE: z.string().default('UTC'),
    DATABASE_URL: z.string().min(1),
    STORAGE_PATH: z.string().default('./storage'),
    MAIL_HOST: z.string().optional(),
    MAIL_PORT: z.coerce.number().default(587),
    MAIL_USERNAME: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    MAIL_FROM_ADDRESS: z.string().default('no-reply@example.com'),
    MAIL_FROM_NAME: z.string().default('Ammonode'),
  })
  .safeParse(process.env)

if (!env.success) {
  console.error('Invalid environment configuration:')
  for (const issue of env.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}

const e = env.data

export const config = {
  url: e.APP_URL.replace(/\/$/, ''),
  port: e.APP_PORT,
  key: e.APP_KEY,
  env: e.APP_ENV,
  isDev: e.APP_ENV === 'development',
  timezone: e.APP_TIMEZONE,
  databaseUrl: e.DATABASE_URL,
  storagePath: resolve(e.STORAGE_PATH),
  mail: {
    host: e.MAIL_HOST,
    port: e.MAIL_PORT,
    username: e.MAIL_USERNAME,
    password: e.MAIL_PASSWORD,
    from: { address: e.MAIL_FROM_ADDRESS, name: e.MAIL_FROM_NAME },
  },
}
