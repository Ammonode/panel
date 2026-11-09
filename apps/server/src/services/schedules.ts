import { and, count, eq, lte } from 'drizzle-orm'
import { db, schema } from '../db'
import { logActivity } from '../lib/activity'
import { daemonRequest } from './daemon'
import { cronMatches, registerTask } from './scheduler'

type CronParts = {
  cronMinute: string
  cronHour: string
  cronDayOfMonth: string
  cronMonth: string
  cronDayOfWeek: string
}
export const cronOf = (s: CronParts) =>
  `${s.cronMinute} ${s.cronHour} ${s.cronDayOfMonth} ${s.cronMonth} ${s.cronDayOfWeek}`

/** Next minute (UTC) the cron expression matches, searching up to a year ahead. */
export function nextRun(s: CronParts, from = new Date()): Date | null {
  const expr = cronOf(s)
  const d = new Date(from)
  d.setUTCSeconds(0, 0)
  d.setUTCMinutes(d.getUTCMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(expr, d)) return d
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Runs a schedule's tasks in order. Manual runs ignore `isActive`. */
export async function runSchedule(scheduleId: number, manual = false) {
  const claimed = await db
    .update(schema.schedules)
    .set({ isProcessing: true })
    .where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.isProcessing, false)))
    .returning()
  const schedule = claimed[0]
  if (!schedule) return
  try {
    const server = await db.query.servers.findFirst({ where: eq(schema.servers.id, schedule.serverId) })
    const node = server ? await db.query.nodes.findFirst({ where: eq(schema.nodes.id, server.nodeId) }) : null
    if (!server || !node || server.status) return
    const base = `/api/servers/${server.uuid}`

    if (schedule.onlyWhenOnline) {
      const state = await daemonRequest<{ state: string }>(node, 'GET', base).catch(() => null)
      if (state?.state !== 'running') return
    }
    const tasks = await db.query.scheduleTasks.findMany({
      where: eq(schema.scheduleTasks.scheduleId, schedule.id),
      orderBy: schema.scheduleTasks.sequence,
    })
    for (const task of tasks) {
      if (task.timeOffset) await sleep(task.timeOffset * 1000)
      try {
        if (task.action === 'command')
          await daemonRequest(node, 'POST', `${base}/commands`, { commands: [task.payload] })
        if (task.action === 'power')
          await daemonRequest(node, 'POST', `${base}/power`, { action: task.payload })
        if (task.action === 'backup') {
          const [{ n }] = (await db
            .select({ n: count() })
            .from(schema.backups)
            .where(eq(schema.backups.serverId, server.id))) as [{ n: number }]
          if (n >= server.backupLimit) throw new Error('backup limit reached')
          const [backup] = await db
            .insert(schema.backups)
            .values({
              uuid: crypto.randomUUID(),
              serverId: server.id,
              name: `${schedule.name} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
              ignoredFiles: task.payload,
            })
            .returning()
          await daemonRequest(node, 'POST', `${base}/backup`, { uuid: backup!.uuid, ignore: task.payload })
        }
      } catch (e) {
        await logActivity({
          event: 'server:schedule.task-failed',
          subject: { type: 'server', id: server.id },
          properties: { schedule: schedule.name, task: task.sequence, error: (e as Error).message },
        })
        if (!task.continueOnFailure) break
      }
    }
    await logActivity({
      event: 'server:schedule.run',
      subject: { type: 'server', id: server.id },
      properties: { schedule: schedule.name, manual },
    })
  } finally {
    await db
      .update(schema.schedules)
      .set({ isProcessing: false, lastRunAt: new Date(), nextRunAt: nextRun(schedule) })
      .where(eq(schema.schedules.id, scheduleId))
  }
}

export function registerScheduleRunner() {
  registerTask('servers:schedules', '* * * * *', async () => {
    const due = await db.query.schedules.findMany({
      where: and(
        eq(schema.schedules.isActive, true),
        eq(schema.schedules.isProcessing, false),
        lte(schema.schedules.nextRunAt, new Date()),
      ),
    })
    // Run in parallel; each run is independent and claimed atomically.
    await Promise.all(due.map((s) => runSchedule(s.id)))
  })
}
