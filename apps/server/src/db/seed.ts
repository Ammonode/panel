import { eq } from 'drizzle-orm'
import { db, schema } from '.'

/** Idempotent seed of the data every installation needs. */
export async function seed() {
  const admin = await db.query.roles.findFirst({ where: eq(schema.roles.name, 'Administrator') })
  if (!admin) await db.insert(schema.roles).values({ name: 'Administrator', permissions: ['*'] })

  const currency = await db.query.currencies.findFirst()
  if (!currency) await db.insert(schema.currencies).values({ code: 'USD', prefix: '$', isDefault: true })

  const defaultNests = [
    { name: 'Minecraft', description: 'Minecraft - the classic game from Mojang.' },
    { name: 'Source Engine', description: 'Includes support for most Source Dedicated Server games.' },
    { name: 'Voice Servers', description: 'Voice servers such as Mumble and Teamspeak 3.' },
    { name: 'Rust', description: 'Rust - A game where you must fight to survive.' },
    { name: 'Applications', description: 'Databases, bots and other applications.' },
  ]
  const nests = await db.query.nests.findMany()
  if (!nests.length) {
    await db
      .insert(schema.nests)
      .values(defaultNests.map((n) => ({ ...n, uuid: crypto.randomUUID(), author: 'support@ammonode.com' })))
  }

  const dept = await db.query.ticketDepartments.findFirst()
  if (!dept)
    await db
      .insert(schema.ticketDepartments)
      .values([{ name: 'General' }, { name: 'Billing' }, { name: 'Technical' }])

  console.log('Seed complete.')
}
