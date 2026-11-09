import { and, eq, lte, sql } from 'drizzle-orm'
import { db, schema } from '../db'

/**
 * Durable background jobs stored in Postgres. Workers claim jobs with
 * FOR UPDATE SKIP LOCKED, so several panel processes can run side by side.
 */
type Handler = (payload: Record<string, unknown>) => Promise<void>
const handlers = new Map<string, Handler>()

export function defineJob(name: string, handler: Handler) {
  handlers.set(name, handler)
}

export async function enqueue(
  name: string,
  payload: Record<string, unknown>,
  opts: { delaySeconds?: number; maxAttempts?: number } = {},
) {
  await db.insert(schema.jobs).values({
    name,
    payload,
    maxAttempts: opts.maxAttempts ?? 5,
    runAt: new Date(Date.now() + (opts.delaySeconds ?? 0) * 1000),
  })
}

async function claim() {
  const rows = await db.execute<{ id: number }>(sql`
    update jobs set locked_at = now(), attempts = attempts + 1
    where id = (
      select id from jobs
      where run_at <= now() and (locked_at is null or locked_at < now() - interval '10 minutes')
      order by run_at limit 1 for update skip locked
    ) returning id`)
  const id = rows[0]?.id
  return id ? db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) }) : null
}

async function runOne() {
  const job = await claim()
  if (!job) return false
  const handler = handlers.get(job.name)
  try {
    if (!handler) throw new Error(`No handler for job ${job.name}`)
    await handler(job.payload as Record<string, unknown>)
    await db.delete(schema.jobs).where(eq(schema.jobs.id, job.id))
  } catch (e) {
    const message = (e as Error).message
    if (job.attempts >= job.maxAttempts) {
      console.error(`Job ${job.name}#${job.id} failed permanently: ${message}`)
      // Keep failed jobs for a week so admins can see what went wrong.
      await db
        .update(schema.jobs)
        .set({ lastError: message, lockedAt: null, runAt: new Date(Date.now() + 7 * 86_400_000) })
        .where(eq(schema.jobs.id, job.id))
    } else {
      // Exponential backoff: 30s, 2m, 8m, 32m...
      const delay = 30 * 4 ** (job.attempts - 1)
      await db
        .update(schema.jobs)
        .set({ lastError: message, lockedAt: null, runAt: new Date(Date.now() + delay * 1000) })
        .where(eq(schema.jobs.id, job.id))
    }
  }
  return true
}

let running = false
export function startQueueWorker() {
  if (running) return
  running = true
  const loop = async () => {
    try {
      // Drain what is due, then wait a little.
      while (await runOne()) {}
    } catch (e) {
      console.error('Queue worker error:', e)
    }
    setTimeout(loop, 3000)
  }
  void loop()
}

/** Removes permanently failed jobs older than a week. */
export async function pruneFailedJobs() {
  await db
    .delete(schema.jobs)
    .where(
      and(sql`${schema.jobs.attempts} >= ${schema.jobs.maxAttempts}`, lte(schema.jobs.runAt, new Date())),
    )
}
