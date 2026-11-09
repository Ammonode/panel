import { and, eq } from 'drizzle-orm'
import { config } from '../config'
import { db, schema } from '../db'
import { decrypt, randomString } from '../lib/crypto'
import { HttpError } from '../lib/errors'
import { getSetting, getSettings } from '../lib/settings'

export type OAuthProfile = {
  id: string
  email: string | null
  emailVerified: boolean
  name: string | null
  username: string | null
}

type Provider = {
  label: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  profile: (token: string) => Promise<OAuthProfile>
}

const json = async <T>(url: string, token: string): Promise<T> => {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'Ammonode-Panel' },
  })
  if (!res.ok) throw new Error(`profile request failed (${res.status})`)
  return res.json() as Promise<T>
}

export const providers: Record<string, Provider> = {
  discord: {
    label: 'Discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    async profile(token) {
      const u = await json<{
        id: string
        email?: string
        verified?: boolean
        username: string
        global_name?: string
      }>('https://discord.com/api/users/@me', token)
      return {
        id: u.id,
        email: u.email ?? null,
        emailVerified: !!u.verified,
        name: u.global_name ?? u.username,
        username: u.username,
      }
    },
  },
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async profile(token) {
      const u = await json<{ sub: string; email?: string; email_verified?: boolean; name?: string }>(
        'https://openidconnect.googleapis.com/v1/userinfo',
        token,
      )
      return {
        id: u.sub,
        email: u.email ?? null,
        emailVerified: !!u.email_verified,
        name: u.name ?? null,
        username: null,
      }
    },
  },
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(token) {
      const u = await json<{ id: number; login: string; name?: string }>('https://api.github.com/user', token)
      // The profile email may be private; the emails endpoint says which one is verified.
      const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>(
        'https://api.github.com/user/emails',
        token,
      ).catch(() => [])
      const primary = emails.find((e) => e.primary) ?? emails.find((e) => e.verified)
      return {
        id: String(u.id),
        email: primary?.email ?? null,
        emailVerified: !!primary?.verified,
        name: u.name ?? u.login,
        username: u.login,
      }
    },
  },
}

export const callbackUrl = (provider: string) => `${config.url}/api/auth/oauth/${provider}/callback`

async function credentials(provider: string) {
  const s = await getSettings([
    `oauth.${provider}.enabled`,
    `oauth.${provider}.client_id`,
    `oauth.${provider}.client_secret`,
  ])
  if (!providers[provider] || s[`oauth.${provider}.enabled`] !== true) return null
  let secret = ''
  try {
    secret = s[`oauth.${provider}.client_secret`] ? decrypt(String(s[`oauth.${provider}.client_secret`])) : ''
  } catch {}
  const id = String(s[`oauth.${provider}.client_id`] ?? '')
  return id && secret ? { id, secret } : null
}

export async function enabledProviders() {
  const out = []
  for (const [key, p] of Object.entries(providers))
    if (await credentials(key)) out.push({ id: key, label: p.label })
  return out
}

export async function authorizeUrl(provider: string, state: string) {
  const creds = await credentials(provider)
  if (!creds) throw new HttpError(404, 'This sign in method is not available', 'not_found')
  const p = providers[provider]!
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: callbackUrl(provider),
    response_type: 'code',
    scope: p.scope,
    state,
    prompt: provider === 'google' ? 'select_account' : 'consent',
  })
  return `${p.authorizeUrl}?${params}`
}

export async function exchangeCode(provider: string, code: string): Promise<OAuthProfile> {
  const creds = await credentials(provider)
  if (!creds) throw new HttpError(404, 'This sign in method is not available', 'not_found')
  const p = providers[provider]!
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(provider),
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
    error?: string
  }
  if (!res.ok || !data.access_token)
    throw new HttpError(
      400,
      `Sign in failed: ${data.error_description ?? data.error ?? res.statusText}`,
      'oauth_failed',
    )
  return p.profile(data.access_token)
}

/**
 * Finds or creates the local user for a provider profile.
 * - an already linked account signs in;
 * - `linkTo` (a signed in user) links the provider to that user;
 * - an existing user with the same *verified* email is linked;
 * - otherwise a new account is created when registration is open.
 */
export async function resolveUser(provider: string, profile: OAuthProfile, linkTo: number | null) {
  const linked = await db.query.oauthAccounts.findFirst({
    where: and(eq(schema.oauthAccounts.provider, provider), eq(schema.oauthAccounts.providerId, profile.id)),
  })
  if (linkTo) {
    if (linked && linked.userId !== linkTo)
      throw new HttpError(409, 'This account is already connected to another user', 'conflict')
    if (!linked)
      await db.insert(schema.oauthAccounts).values({ provider, providerId: profile.id, userId: linkTo })
    return { userId: linkTo, created: false, linked: true }
  }
  if (linked) return { userId: linked.userId, created: false, linked: false }

  if (!profile.email || !profile.emailVerified) {
    throw new HttpError(
      422,
      `Your ${providers[provider]?.label ?? provider} account has no verified email address`,
      'unverified_email',
    )
  }
  const email = profile.email.toLowerCase()
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) })
  if (existing) {
    await db.insert(schema.oauthAccounts).values({ provider, providerId: profile.id, userId: existing.id })
    return { userId: existing.id, created: false, linked: true }
  }
  if (!(await getSetting('auth.registration')))
    throw new HttpError(403, 'Registration is disabled', 'forbidden')

  // Unique username from the provider name or the email.
  const base =
    (profile.username ?? email.split('@')[0] ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 24) || 'user'
  let username = base.length >= 3 ? base : `${base}user`
  while (await db.query.users.findFirst({ where: eq(schema.users.username, username) }))
    username = `${base.slice(0, 20)}${randomString(4).toLowerCase()}`
  const [first, ...rest] = (profile.name ?? '').trim().split(/\s+/)
  const [user] = await db
    .insert(schema.users)
    .values({
      uuid: crypto.randomUUID(),
      email,
      username,
      firstName: first || null,
      lastName: rest.join(' ') || null,
      password: null,
      emailVerifiedAt: new Date(),
    })
    .returning()
  await db.insert(schema.oauthAccounts).values({ provider, providerId: profile.id, userId: user!.id })
  return { userId: user!.id, created: true, linked: true }
}
