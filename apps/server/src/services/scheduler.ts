import { db } from '../db'

/**
 * Minimal in-process scheduler. Every task runs inside a Postgres advisory
 * lock, so running several panel processes never executes a task twice.
 */
type Task = { name: string; cron: string; run: () => Promise<void> }
const tasks = new Map<string, Task>()

function matchField(field: string, value: number, min: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepRaw] = part.split('/') as [string, string?]
    const step = stepRaw ? Number(stepRaw) : 1
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = Number.MAX_SAFE_INTEGER
    } else if (range.includes('-')) {
      ;[lo, hi] = range.split('-').map(Number) as [number, number]
    } else {
      lo = Number(range)
      hi = stepRaw ? Number.MAX_SAFE_INTEGER : lo
    }
    return value >= lo && value <= hi && (value - lo) % step === 0
  })
}

/** Standard 5 field cron expression (minute hour day-of-month month day-of-week), UTC. */
export function cronMatches(expr: string, d: Date) {
  const [m = '*', h = '*', dom = '*', mon = '*', dow = '*'] = expr.trim().split(/\s+/)
  return (
    matchField(m, d.getUTCMinutes(), 0) &&
    matchField(h, d.getUTCHours(), 0) &&
    matchField(dom, d.getUTCDate(), 1) &&
    matchField(mon, d.getUTCMonth() + 1, 1) &&
    matchField(dow, d.getUTCDay(), 0)
  )
}

export function registerTask(name: string, cron: string, run: () => Promise<void>) {
  tasks.set(name, { name, cron, run })
}

const lockKey = (name: string) => {
  let h = 0
  for (const c of name) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return h
}

export async function runTask(task: Task) {
  const reserved = await db.$client.reserve()
  try {
    const [row] = await reserved`select pg_try_advisory_lock(${lockKey(task.name)}) as ok`
    if (!row?.ok) return
    try {
      await task.run()
    } catch (e) {
      console.error(`Scheduled task ${task.name} failed:`, e)
    } finally {
      await reserved`select pg_advisory_unlock(${lockKey(task.name)})`
    }
  } finally {
    reserved.release()
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

export function startScheduler() {
  const tick = () => {
    const now = new Date()
    for (const task of tasks.values()) if (cronMatches(task.cron, now)) void runTask(task)
    // Align to the start of the next minute.
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
  }
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
}

export const stopScheduler = () => clearTimeout(timer)
