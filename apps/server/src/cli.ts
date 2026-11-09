#!/usr/bin/env bun
/**
 * Ammonode command line.
 *   bun apps/server/src/cli.ts <command>
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const [command, ...rest] = process.argv.slice(2)

const help = `Ammonode CLI

Commands:
  key:generate            Print a new APP_KEY value
  migrate                 Run database migrations
  seed                    Seed default roles, currency and nests
  user:make               Create a user (--email --username --password [--admin])
  setup                   migrate + seed + create the first admin interactively
`

async function migrate() {
  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  const { db, sql } = await import('./db')
  await migrate(db, { migrationsFolder: join(import.meta.dir, '../drizzle') })
  console.log('Migrations complete.')
  return sql
}

async function makeUser(opts: { email: string; username: string; password: string; admin?: boolean }) {
  const { db, schema } = await import('./db')
  const { hashPassword } = await import('./lib/crypto')
  const { eq } = await import('drizzle-orm')
  const role = opts.admin
    ? await db.query.roles.findFirst({ where: eq(schema.roles.name, 'Administrator') })
    : null
  const [user] = await db
    .insert(schema.users)
    .values({
      uuid: crypto.randomUUID(),
      email: opts.email.toLowerCase(),
      username: opts.username,
      password: await hashPassword(opts.password),
      roleId: role?.id ?? null,
      emailVerifiedAt: new Date(),
    })
    .returning()
  console.log(`Created user #${user!.id} ${user!.email}${role ? ' (Administrator)' : ''}`)
}

switch (command) {
  case 'key:generate':
    console.log(randomBytes(32).toString('base64'))
    break
  case 'migrate': {
    const sql = await migrate()
    await sql.end()
    break
  }
  case 'seed': {
    const { seed } = await import('./db/seed')
    await seed()
    process.exit(0)
    break
  }
  case 'user:make': {
    const { values } = parseArgs({
      args: rest,
      options: {
        email: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        admin: { type: 'boolean' },
      },
    })
    if (!values.email || !values.username || !values.password) {
      console.error('Usage: user:make --email <email> --username <name> --password <password> [--admin]')
      process.exit(1)
    }
    await makeUser(values as { email: string; username: string; password: string; admin?: boolean })
    process.exit(0)
    break
  }
  case 'setup': {
    await migrate()
    const { seed } = await import('./db/seed')
    await seed()
    const email = prompt('Admin email:')
    const username = prompt('Admin username:')
    const password = prompt('Admin password (min 8 characters):')
    if (email && username && password && password.length >= 8) {
      await makeUser({ email, username, password, admin: true })
    } else {
      console.log('Skipped admin creation. Run `user:make --admin` later.')
    }
    process.exit(0)
    break
  }
  default:
    console.log(help)
}
