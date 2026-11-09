/**
 * Public contract between Ammonode and its extensions.
 * Anything exported here is covered by semver; internals are not.
 */

export type ExtensionType = 'gateway' | 'server' | 'addon' | 'theme'

/** Contents of `extension.json` at the root of every extension. */
export interface ExtensionManifest {
  id: string
  name: string
  type: ExtensionType
  version: string
  description?: string
  author?: string
  homepage?: string
  /** Semver range of Ammonode versions this extension supports. */
  ammonode: string
  /** Server entry, relative to the extension root. */
  server?: string
  /** Browser entry (ES module), relative to the extension root. */
  web?: string
  /** Theme stylesheet (themes only). */
  stylesheet?: string
}

export type SettingField =
  | {
      key: string
      label: string
      type: 'text' | 'password' | 'url' | 'email'
      required?: boolean
      default?: string
      description?: string
    }
  | {
      key: string
      label: string
      type: 'number'
      required?: boolean
      default?: number
      min?: number
      max?: number
      description?: string
    }
  | { key: string; label: string; type: 'boolean'; default?: boolean; description?: string }
  | {
      key: string
      label: string
      type: 'select'
      options: { value: string; label: string }[]
      default?: string
      description?: string
    }

export interface Money {
  amount: string
  currency: string
}

export interface CheckoutContext {
  invoice: { id: number; number: string | null; total: Money; userId: number }
  user: { id: number; email: string; name: string }
  returnUrl: string
  cancelUrl: string
  /** Settings saved for this extension in the admin area. */
  settings: Record<string, unknown>
}

/** Payment gateway extension. */
export interface Gateway {
  /** Return a URL to redirect the customer to, or HTML to render. */
  pay(ctx: CheckoutContext): Promise<{ redirect: string } | { html: string }>
  /** Handle the provider webhook at `/api/extensions/<id>/webhook`. */
  webhook?(request: Request, api: ExtensionApi): Promise<Response>
  refund?(transactionId: string, amount: Money, settings: Record<string, unknown>): Promise<void>
}

export interface ServiceContext {
  service: { id: number; userId: number; status: string; properties: Record<string, unknown> }
  product: { id: number; name: string; settings: Record<string, unknown> }
  configOptions: Record<string, string>
  settings: Record<string, unknown>
}

/** Provisioner extension, called when services change state. */
export interface Provisioner {
  productSettings?(): SettingField[] | Promise<SettingField[]>
  create(ctx: ServiceContext): Promise<Record<string, unknown> | undefined>
  suspend(ctx: ServiceContext): Promise<void>
  unsuspend(ctx: ServiceContext): Promise<void>
  terminate(ctx: ServiceContext): Promise<void>
  upgrade?(ctx: ServiceContext): Promise<void>
  /** Link shown on the service page, e.g. to the server console. */
  loginUrl?(ctx: ServiceContext): Promise<string | null>
}

export type CoreEvent =
  | 'user.created'
  | 'invoice.created'
  | 'invoice.paid'
  | 'service.created'
  | 'service.suspended'
  | 'service.terminated'
  | 'server.created'
  | 'server.installed'
  | 'ticket.created'
  | 'ticket.replied'

/** Object passed to an extension's `register()` function. */
export interface ExtensionApi {
  id: string
  settings(): Promise<Record<string, unknown>>
  on(event: CoreEvent, handler: (payload: Record<string, unknown>) => void | Promise<void>): void
  /** Mount a Hono-compatible fetch handler at `/api/extensions/<id>/*`. */
  routes(handler: (request: Request) => Response | Promise<Response>): void
  /** Run a function on a cron expression. */
  schedule(cron: string, task: () => Promise<void>): void
  markInvoicePaid(
    invoiceId: number,
    transaction: { gateway: string; transactionId: string; amount: string; fee?: string },
  ): Promise<void>
  log: { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void }
}

export interface ServerExtension {
  settings?: SettingField[]
  register?(api: ExtensionApi): void | Promise<void>
  gateway?: Gateway
  provisioner?: Provisioner
}

export const defineExtension = (ext: ServerExtension) => ext
