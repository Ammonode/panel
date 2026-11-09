import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { timestamps, users } from './auth'

const money = (name: string) => numeric(name, { precision: 14, scale: 2 })

export const currencies = pgTable('currencies', {
  code: varchar('code', { length: 3 }).primaryKey(),
  prefix: varchar('prefix', { length: 8 }).notNull().default(''),
  suffix: varchar('suffix', { length: 8 }).notNull().default(''),
  // 1.00 = same as default currency
  rate: numeric('rate', { precision: 14, scale: 6 }).notNull().default('1'),
  isDefault: boolean('is_default').notNull().default(false),
})

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id'),
  slug: varchar('slug', { length: 191 }).notNull().unique(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  image: text('image'),
  fullStock: boolean('full_stock').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  hidden: boolean('hidden').notNull().default(false),
  ...timestamps,
})

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  slug: varchar('slug', { length: 191 }).notNull().unique(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  image: text('image'),
  stock: integer('stock'),
  perUserLimit: integer('per_user_limit'),
  allowQuantity: varchar('allow_quantity', { length: 16 }).notNull().default('disabled'),
  hidden: boolean('hidden').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  // Extension id of the provisioner (e.g. `ammonode-game`) and its product settings.
  serverExtension: varchar('server_extension', { length: 64 }),
  serverSettings: jsonb('server_settings').$type<Record<string, unknown>>().notNull().default({}),
  emailTemplate: text('email_template'),
  ...timestamps,
})

export const productUpgrades = pgTable(
  'product_upgrades',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    upgradeId: integer('upgrade_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('product_upgrades_unique').on(t.productId, t.upgradeId)],
)

// A plan is a billing option of a product, config option or other priceable item.
export const plans = pgTable(
  'plans',
  {
    id: serial('id').primaryKey(),
    priceableType: varchar('priceable_type', { length: 32 }).notNull(), // product | config_option
    priceableId: integer('priceable_id').notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    type: varchar('type', { length: 16 }).notNull().default('recurring'), // free | one-time | recurring
    billingPeriod: integer('billing_period').notNull().default(1),
    billingUnit: varchar('billing_unit', { length: 8 }).notNull().default('month'), // day | week | month | year
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('plans_priceable_idx').on(t.priceableType, t.priceableId)],
)

export const prices = pgTable(
  'prices',
  {
    id: serial('id').primaryKey(),
    planId: integer('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    currencyCode: varchar('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    price: money('price').notNull().default('0'),
    setupFee: money('setup_fee').notNull().default('0'),
  },
  (t) => [uniqueIndex('prices_plan_currency').on(t.planId, t.currencyCode)],
)

export const configOptions = pgTable('config_options', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id'), // children = the selectable values
  name: varchar('name', { length: 191 }).notNull(),
  envVariable: varchar('env_variable', { length: 191 }),
  type: varchar('type', { length: 16 }).notNull().default('select'), // select | radio | slider | number | text | checkbox
  sort: integer('sort').notNull().default(0),
  hidden: boolean('hidden').notNull().default(false),
  upgradable: boolean('upgradable').notNull().default(false),
  ...timestamps,
})

export const configOptionProducts = pgTable(
  'config_option_products',
  {
    configOptionId: integer('config_option_id')
      .notNull()
      .references(() => configOptions.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('config_option_products_unique').on(t.configOptionId, t.productId)],
)

export const coupons = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  type: varchar('type', { length: 16 }).notNull().default('percentage'), // percentage | fixed | free_setup
  value: money('value').notNull().default('0'),
  // Number of billing cycles the discount applies to; null = forever, 1 = first payment only.
  recurring: integer('recurring'),
  maxUses: integer('max_uses'),
  maxUsesPerUser: integer('max_uses_per_user'),
  productIds: jsonb('product_ids').$type<number[]>().notNull().default([]),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  ...timestamps,
})

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  couponId: integer('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  ...timestamps,
})

export const services = pgTable(
  'services',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    planId: integer('plan_id')
      .notNull()
      .references(() => plans.id),
    couponId: integer('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'), // pending | active | suspended | cancelled
    quantity: integer('quantity').notNull().default(1),
    price: money('price').notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    subscriptionId: varchar('subscription_id', { length: 191 }),
    // Data returned by the provisioner (e.g. created server uuid).
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index('services_user_idx').on(t.userId)],
)

export const serviceConfigs = pgTable('service_configs', {
  id: serial('id').primaryKey(),
  serviceId: integer('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  configOptionId: integer('config_option_id')
    .notNull()
    .references(() => configOptions.id, { onDelete: 'cascade' }),
  configValueId: integer('config_value_id'),
  value: text('value'),
})

export const serviceCancellations = pgTable('service_cancellations', {
  id: serial('id').primaryKey(),
  serviceId: integer('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull().default('end_of_period'), // immediate | end_of_period
  reason: text('reason'),
  ...timestamps,
})

export const serviceUpgrades = pgTable('service_upgrades', {
  id: serial('id').primaryKey(),
  serviceId: integer('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  planId: integer('plan_id')
    .notNull()
    .references(() => plans.id),
  invoiceId: integer('invoice_id'),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // pending | completed | cancelled
  ...timestamps,
})

export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    number: varchar('number', { length: 32 }).unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: varchar('status', { length: 16 }).notNull().default('pending'), // pending | paid | cancelled | refunded
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('invoices_user_idx').on(t.userId), index('invoices_status_idx').on(t.status)],
)

export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  price: money('price').notNull(),
  quantity: integer('quantity').notNull().default(1),
  // service | service_upgrade | credit | custom
  referenceType: varchar('reference_type', { length: 32 }),
  referenceId: integer('reference_id'),
  ...timestamps,
})

export const invoiceTransactions = pgTable('invoice_transactions', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  gateway: varchar('gateway', { length: 64 }), // null = credit balance
  transactionId: varchar('transaction_id', { length: 191 }),
  amount: money('amount').notNull(),
  fee: money('fee').notNull().default('0'),
  status: varchar('status', { length: 16 }).notNull().default('succeeded'), // processing | succeeded | failed | refunded
  ...timestamps,
})

export const taxRates = pgTable('tax_rates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  rate: numeric('rate', { precision: 6, scale: 3 }).notNull(),
  country: varchar('country', { length: 2 }), // null = all countries
  state: varchar('state', { length: 64 }),
  ...timestamps,
})

export const ticketDepartments = pgTable('ticket_departments', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  sort: integer('sort').notNull().default(0),
})

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    subject: varchar('subject', { length: 191 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'), // open | answered | replied | closed
    priority: varchar('priority', { length: 16 }).notNull().default('medium'), // low | medium | high
    departmentId: integer('department_id').references(() => ticketDepartments.id, { onDelete: 'set null' }),
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'set null' }),
    assignedTo: integer('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('tickets_user_idx').on(t.userId)],
)

export const ticketMessages = pgTable('ticket_messages', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  message: text('message').notNull(),
  attachments: jsonb('attachments')
    .$type<{ name: string; path: string; size: number }[]>()
    .notNull()
    .default([]),
  ...timestamps,
})

export const announcements = pgTable('announcements', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 191 }).notNull().unique(),
  title: varchar('title', { length: 191 }).notNull(),
  description: text('description'),
  content: text('content').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps,
})

export const affiliates = pgTable('affiliates', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 32 }).notNull().unique(),
  rewardPercent: numeric('reward_percent', { precision: 5, scale: 2 }),
  visitors: integer('visitors').notNull().default(0),
  ...timestamps,
})

export const affiliateReferrals = pgTable('affiliate_referrals', {
  id: serial('id').primaryKey(),
  affiliateId: integer('affiliate_id')
    .notNull()
    .references(() => affiliates.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  earnings: jsonb('earnings').$type<Record<string, string>>().notNull().default({}),
  ...timestamps,
})
