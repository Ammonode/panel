import { and, eq, gt } from 'drizzle-orm'
import { config } from '../config'
import { db, schema } from '../db'
import { randomToken, sha256 } from '../lib/crypto'
import { mailUser } from './mail'

type TokenType = 'password_reset' | 'verify_email'
const ttl: Record<TokenType, number> = { password_reset: 60 * 60_000, verify_email: 24 * 60 * 60_000 }

/** Creates a one-time token (only its hash is stored) and replaces older ones. */
async function issue(userId: number, type: TokenType) {
  const token = randomToken()
  await db
    .delete(schema.authTokens)
    .where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.type, type)))
  await db
    .insert(schema.authTokens)
    .values({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl[type]) })
  return token
}

/** Returns the user id and deletes the token, or null when invalid/expired. */
export async function consume(token: string, type: TokenType) {
  const [row] = await db
    .delete(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.tokenHash, sha256(token)),
        eq(schema.authTokens.type, type),
        gt(schema.authTokens.expiresAt, new Date()),
      ),
    )
    .returning()
  return row?.userId ?? null
}

export async function sendPasswordReset(userId: number) {
  const token = await issue(userId, 'password_reset')
  await mailUser(userId, 'auth.password_reset', { url: `${config.url}/reset-password?token=${token}` })
}

export async function sendVerification(userId: number) {
  const token = await issue(userId, 'verify_email')
  await mailUser(userId, 'auth.verify_email', { url: `${config.url}/verify-email?token=${token}` })
}
