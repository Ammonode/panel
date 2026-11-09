import {
  bigint,
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { timestamps, users } from './auth'

export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  short: varchar('short', { length: 60 }).notNull().unique(),
  long: text('long'),
  ...timestamps,
})

export const nodes = pgTable('nodes', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 36 }).notNull().unique(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id),
  fqdn: varchar('fqdn', { length: 191 }).notNull(),
  scheme: varchar('scheme', { length: 8 }).notNull().default('https'),
  behindProxy: boolean('behind_proxy').notNull().default(false),
  public: boolean('public').notNull().default(true),
  maintenance: boolean('maintenance').notNull().default(false),
  memory: integer('memory').notNull(),
  memoryOverallocate: integer('memory_overallocate').notNull().default(0),
  disk: integer('disk').notNull(),
  diskOverallocate: integer('disk_overallocate').notNull().default(0),
  uploadSize: integer('upload_size').notNull().default(100),
  daemonListen: integer('daemon_listen').notNull().default(8080),
  daemonSftp: integer('daemon_sftp').notNull().default(2022),
  daemonBase: varchar('daemon_base', { length: 191 }).notNull().default('/var/lib/ammonode/volumes'),
  tokenId: varchar('token_id', { length: 16 }).notNull().unique(),
  // Encrypted with APP_KEY; the daemon needs the plain value.
  token: text('token').notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  ...timestamps,
})

export const allocations = pgTable(
  'allocations',
  {
    id: serial('id').primaryKey(),
    nodeId: integer('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    ip: varchar('ip', { length: 45 }).notNull(),
    ipAlias: varchar('ip_alias', { length: 191 }),
    port: integer('port').notNull(),
    serverId: integer('server_id'),
    notes: varchar('notes', { length: 256 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('allocations_node_ip_port').on(t.nodeId, t.ip, t.port),
    index('allocations_server_idx').on(t.serverId),
  ],
)

export const nests = pgTable('nests', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 36 }).notNull().unique(),
  author: varchar('author', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  ...timestamps,
})

export type EggConfig = {
  files: Record<string, { parser: string; find: Record<string, unknown> }>
  startup: { done: string | string[]; userInteraction?: string[] }
  logs: Record<string, unknown>
  stop: string
}

export const eggs = pgTable('eggs', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 36 }).notNull().unique(),
  nestId: integer('nest_id')
    .notNull()
    .references(() => nests.id, { onDelete: 'cascade' }),
  author: varchar('author', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  // json (not jsonb) keeps the egg's order: the first image is the default for new servers.
  dockerImages: json('docker_images').$type<Record<string, string>>().notNull().default({}),
  fileDenylist: jsonb('file_denylist').$type<string[]>().notNull().default([]),
  updateUrl: text('update_url'),
  forceOutgoingIp: boolean('force_outgoing_ip').notNull().default(false),
  startup: text('startup').notNull(),
  config: jsonb('config').$type<EggConfig>().notNull(),
  configFrom: integer('config_from'),
  scriptContainer: varchar('script_container', { length: 191 }).notNull().default('alpine:3.4'),
  scriptEntry: varchar('script_entry', { length: 191 }).notNull().default('ash'),
  scriptInstall: text('script_install'),
  scriptIsPrivileged: boolean('script_is_privileged').notNull().default(true),
  copyScriptFrom: integer('copy_script_from'),
  // Where the egg was imported from (eggs.pterodactyl.io raw URL), used for updates.
  sourceUrl: text('source_url'),
  ...timestamps,
})

export const eggVariables = pgTable('egg_variables', {
  id: serial('id').primaryKey(),
  eggId: integer('egg_id')
    .notNull()
    .references(() => eggs.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description').notNull().default(''),
  envVariable: varchar('env_variable', { length: 191 }).notNull(),
  defaultValue: text('default_value').notNull().default(''),
  userViewable: boolean('user_viewable').notNull().default(true),
  userEditable: boolean('user_editable').notNull().default(true),
  rules: text('rules').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  ...timestamps,
})

export const servers = pgTable(
  'servers',
  {
    id: serial('id').primaryKey(),
    uuid: varchar('uuid', { length: 36 }).notNull().unique(),
    uuidShort: varchar('uuid_short', { length: 8 }).notNull().unique(),
    externalId: varchar('external_id', { length: 191 }).unique(),
    name: varchar('name', { length: 191 }).notNull(),
    description: text('description'),
    // installing | install_failed | reinstall_failed | suspended | restoring_backup | null (ok)
    status: varchar('status', { length: 32 }).default('installing'),
    skipScripts: boolean('skip_scripts').notNull().default(false),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id),
    nodeId: integer('node_id')
      .notNull()
      .references(() => nodes.id),
    allocationId: integer('allocation_id').notNull(),
    nestId: integer('nest_id')
      .notNull()
      .references(() => nests.id),
    eggId: integer('egg_id')
      .notNull()
      .references(() => eggs.id),
    memory: integer('memory').notNull(),
    swap: integer('swap').notNull().default(0),
    disk: integer('disk').notNull(),
    io: integer('io').notNull().default(500),
    cpu: integer('cpu').notNull().default(0),
    threads: varchar('threads', { length: 191 }),
    oomDisabled: boolean('oom_disabled').notNull().default(true),
    startup: text('startup').notNull(),
    image: varchar('image', { length: 191 }).notNull(),
    allocationLimit: integer('allocation_limit').notNull().default(0),
    databaseLimit: integer('database_limit').notNull().default(0),
    backupLimit: integer('backup_limit').notNull().default(0),
    // Extra over Pterodactyl: automatic restart when the process crashes.
    crashRestart: boolean('crash_restart').notNull().default(true),
    // Set when this server was split from another (server splitting).
    parentId: integer('parent_id'),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('servers_owner_idx').on(t.ownerId), index('servers_node_idx').on(t.nodeId)],
)

export const serverVariables = pgTable(
  'server_variables',
  {
    id: serial('id').primaryKey(),
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    variableId: integer('variable_id')
      .notNull()
      .references(() => eggVariables.id, { onDelete: 'cascade' }),
    value: text('value').notNull().default(''),
    ...timestamps,
  },
  (t) => [uniqueIndex('server_variables_unique').on(t.serverId, t.variableId)],
)

export const subusers = pgTable(
  'subusers',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex('subusers_unique').on(t.userId, t.serverId)],
)

export const databaseHosts = pgTable('database_hosts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  host: varchar('host', { length: 191 }).notNull(),
  port: integer('port').notNull().default(3306),
  username: varchar('username', { length: 191 }).notNull(),
  password: text('password').notNull(),
  maxDatabases: integer('max_databases'),
  nodeId: integer('node_id').references(() => nodes.id, { onDelete: 'set null' }),
  ...timestamps,
})

export const serverDatabases = pgTable('server_databases', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  databaseHostId: integer('database_host_id')
    .notNull()
    .references(() => databaseHosts.id),
  database: varchar('database', { length: 191 }).notNull(),
  username: varchar('username', { length: 191 }).notNull(),
  remote: varchar('remote', { length: 191 }).notNull().default('%'),
  password: text('password').notNull(),
  maxConnections: integer('max_connections').notNull().default(0),
  ...timestamps,
})

export const mounts = pgTable('mounts', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 36 }).notNull().unique(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  description: text('description'),
  source: varchar('source', { length: 191 }).notNull(),
  target: varchar('target', { length: 191 }).notNull(),
  readOnly: boolean('read_only').notNull().default(false),
  userMountable: boolean('user_mountable').notNull().default(false),
  eggIds: jsonb('egg_ids').$type<number[]>().notNull().default([]),
  nodeIds: jsonb('node_ids').$type<number[]>().notNull().default([]),
})

export const serverMounts = pgTable(
  'server_mounts',
  {
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    mountId: integer('mount_id')
      .notNull()
      .references(() => mounts.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('server_mounts_unique').on(t.serverId, t.mountId)],
)

export const backups = pgTable('backups', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 36 }).notNull().unique(),
  serverId: integer('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  ignoredFiles: text('ignored_files').notNull().default(''),
  disk: varchar('disk', { length: 16 }).notNull().default('local'),
  checksum: varchar('checksum', { length: 191 }),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  isSuccessful: boolean('is_successful').notNull().default(false),
  isLocked: boolean('is_locked').notNull().default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps,
})

export const schedules = pgTable('schedules', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  cronMinute: varchar('cron_minute', { length: 32 }).notNull().default('*'),
  cronHour: varchar('cron_hour', { length: 32 }).notNull().default('*'),
  cronDayOfMonth: varchar('cron_day_of_month', { length: 32 }).notNull().default('*'),
  cronMonth: varchar('cron_month', { length: 32 }).notNull().default('*'),
  cronDayOfWeek: varchar('cron_day_of_week', { length: 32 }).notNull().default('*'),
  isActive: boolean('is_active').notNull().default(true),
  isProcessing: boolean('is_processing').notNull().default(false),
  onlyWhenOnline: boolean('only_when_online').notNull().default(false),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  ...timestamps,
})

export const scheduleTasks = pgTable('schedule_tasks', {
  id: serial('id').primaryKey(),
  scheduleId: integer('schedule_id')
    .notNull()
    .references(() => schedules.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  // command | power | backup
  action: varchar('action', { length: 16 }).notNull(),
  payload: text('payload').notNull().default(''),
  timeOffset: integer('time_offset').notNull().default(0),
  continueOnFailure: boolean('continue_on_failure').notNull().default(false),
  ...timestamps,
})

export const serverTransfers = pgTable(
  'server_transfers',
  {
    id: serial('id').primaryKey(),
    serverId: integer('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    oldNodeId: integer('old_node_id').notNull(),
    newNodeId: integer('new_node_id').notNull(),
    oldAllocationIds: jsonb('old_allocation_ids').$type<number[]>().notNull().default([]),
    newAllocationId: integer('new_allocation_id').notNull(),
    newAdditionalAllocationIds: jsonb('new_additional_allocation_ids')
      .$type<number[]>()
      .notNull()
      .default([]),
    // null = running, true = done, false = failed
    successful: boolean('successful'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('server_transfers_server_idx').on(t.serverId)],
)
