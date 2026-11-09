import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export { timestamps }

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  // List of permission strings, `*` grants everything.
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  ...timestamps,
})

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uuid: varchar('uuid', { length: 36 }).notNull().unique(),
    email: varchar('email', { length: 191 }).notNull(),
    username: varchar('username', { length: 64 }).notNull(),
    firstName: varchar('first_name', { length: 64 }),
    lastName: varchar('last_name', { length: 64 }),
    password: text('password'),
    roleId: integer('role_id').references(() => roles.id, { onDelete: 'set null' }),
    language: varchar('language', { length: 8 }).notNull().default('en'),
    theme: varchar('theme', { length: 16 }).notNull().default('system'),
    credits: jsonb('credits').$type<Record<string, string>>().notNull().default({}),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email), uniqueIndex('users_username_unique').on(t.username)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    // Set when the session is still waiting for the second factor.
    pendingTwoFactor: boolean('pending_two_factor').notNull().default(false),
    impersonatorId: integer('impersonator_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const recoveryCodes = pgTable('recovery_codes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const authTokens = pgTable('auth_tokens', {
  // Hashed one-time tokens for password reset / email verification.
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // `client` keys act as the user, `application` keys use the admin API.
  type: varchar('type', { length: 16 }).notNull().default('client'),
  identifier: varchar('identifier', { length: 16 }).notNull().unique(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  description: varchar('description', { length: 191 }).notNull().default(''),
  allowedIps: jsonb('allowed_ips').$type<string[]>().notNull().default([]),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...timestamps,
})

export const sshKeys = pgTable('ssh_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 191 }).notNull(),
  publicKey: text('public_key').notNull(),
  ...timestamps,
})

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: varchar('provider', { length: 32 }).notNull(),
    providerId: varchar('provider_id', { length: 191 }).notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerId] })],
)
