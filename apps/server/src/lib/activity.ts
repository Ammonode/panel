import { db, schema } from '../db'

export async function logActivity(entry: {
  event: string
  actorId?: number | null
  ip?: string | null
  subject?: { type: string; id: number }
  properties?: Record<string, unknown>
}) {
  await db.insert(schema.activityLogs).values({
    event: entry.event,
    actorId: entry.actorId ?? null,
    ip: entry.ip ?? null,
    subjectType: entry.subject?.type,
    subjectId: entry.subject?.id,
    properties: entry.properties ?? {},
  })
}
