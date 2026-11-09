import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { config } from '../config'

const key = createHash('sha256').update(config.key).digest()

/** Encrypts a value with AES-256-GCM using APP_KEY. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'))
  if (!iv || !tag || !data) throw new Error('Malformed encrypted payload')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const hmac = (value: string) => createHmac('sha256', key).update(value).digest('hex')

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export function randomString(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: 'argon2id' })
export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash)
