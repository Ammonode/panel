import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { timestamps, users } from './auth'

export const settings = pgTable('settings', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const extensions = pgTable('extensions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  type: varchar('type', { length: 16 }).notNull(), // gateway | server | addon | theme
  version: varchar('version', { length: 32 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
})

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: serial('id').primaryKey(),
    event: varchar('event', { length: 191 }).notNull(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    ip: varchar('ip', { length: 45 }),
    // Subject polymorphic reference, e.g. server:12 / invoice:4
    subjectType: varchar('subject_type', { length: 32 }),
    subjectId: integer('subject_id'),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activity_subject_idx').on(t.subjectType, t.subjectId),
    index('activity_actor_idx').on(t.actorId),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 191 }).notNull(),
    body: text('body'),
    url: text('url'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId)],
)

export const emailTemplates = pgTable('email_templates', {
  key: varchar('key', { length: 64 }).primaryKey(),
  subject: varchar('subject', { length: 191 }).notNull(),
  body: text('body').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  ...timestamps,
})

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 191 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_run_idx').on(t.runAt)],
)

export const pages = pgTable('pages', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 191 }).notNull().unique(),
  title: varchar('title', { length: 191 }).notNull(),
  content: text('content').notNull(),
  isPublic: boolean('is_public').notNull().default(true),
  ...timestamps,
})
