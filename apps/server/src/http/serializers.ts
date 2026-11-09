import type { User } from './types'

export const serializeUser = (u: User, permissions: string[] = []) => ({
  id: u.id,
  uuid: u.uuid,
  email: u.email,
  username: u.username,
  firstName: u.firstName,
  lastName: u.lastName,
  language: u.language,
  theme: u.theme,
  country: (u.properties.country as string | undefined) ?? null,
  credits: u.credits,
  emailVerified: !!u.emailVerifiedAt,
  twoFactorEnabled: !!u.totpEnabledAt,
  isAdmin: permissions.length > 0,
  permissions,
  createdAt: u.createdAt,
})
