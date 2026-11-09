import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { sha256 } from '../../lib/crypto'
import { HttpError } from '../../lib/errors'
import { clientIp, SESSION_COOKIE } from './auth'

/**
 * Fixed window limiter kept in memory (per process).
 */
export function rateLimit(opts: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; reset: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
  }, opts.windowMs).unref?.()
  return createMiddleware(async (c, next) => {
    // API key, then browser session, then IP: people behind one shared IP
    // (offices, mobile carriers) do not share a single budget.
    const auth = c.req.header('authorization')?.match(/^Bearer\s+(amn_\w{16})/)?.[1]
    const session = getCookie(c, SESSION_COOKIE)
    const key = auth ?? (session ? `s:${sha256(session).slice(0, 24)}` : `ip:${clientIp(c) ?? 'unknown'}`)
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + opts.windowMs }
      hits.set(key, entry)
    }
    entry.count++
    c.header('x-ratelimit-limit', String(opts.limit))
    c.header('x-ratelimit-remaining', String(Math.max(0, opts.limit - entry.count)))
    if (entry.count > opts.limit) {
      c.header('retry-after', String(Math.ceil((entry.reset - now) / 1000)))
      throw new HttpError(429, 'Too many requests, slow down a little.', 'rate_limited')
    }
    await next()
  })
}
