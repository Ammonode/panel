import type { schema } from '../db'
import { decrypt } from '../lib/crypto'
import { HttpError } from '../lib/errors'

type Node = typeof schema.nodes.$inferSelect

/** Calls the Ammonode daemon running on a node. */
export async function daemonRequest<T = unknown>(
  node: Node,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${node.scheme}://${node.fqdn}:${node.daemonListen}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${decrypt(node.token)}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HttpError(502, `Could not reach the daemon on node "${node.name}"`, 'daemon_unreachable')
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new HttpError(502, data?.error?.message ?? `Daemon returned ${res.status}`, 'daemon_error')
  }
  if (res.status === 204 || res.status === 202) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? await res.json() : await res.text()) as T
}

/** Signs a HS256 JWT with the node token (used for websocket + downloads). */
export async function signDaemonToken(node: Node, claims: Record<string, unknown>, ttlSeconds = 600) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = { ...claims, iat: now, nbf: now - 5, exp: now + ttlSeconds, jti: crypto.randomUUID() }
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(decrypt(node.token)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))).toString(
    'base64url',
  )
  return `${data}.${sig}`
}
