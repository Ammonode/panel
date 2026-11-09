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
  invoice: { id: number; number: string | null; total: Money; userId: number; description: string }
  user: { id: number; email: string; name: string }
  /** Where to send the customer after paying / cancelling. */
  returnUrl: string
  cancelUrl: string
  /** Public URL of this extension's routes, e.g. `https://panel/api/extensions/stripe`. */
  extensionUrl: string
  /** Settings saved for this extension in the admin area. */
  settings: Record<string, unknown>
}

/** Payment gateway extension. */
export interface Gateway {
  /** Name shown to customers at checkout. */
  label?(settings: Record<string, unknown>): string
  /** Return a URL to redirect the customer to, or HTML to render. */
  pay(ctx: CheckoutContext): Promise<{ redirect: string } | { html: string }>
  /** Optional: refund a transaction made through this gateway. */
  refund?(ctx: { transactionId: string; amount: Money; settings: Record<string, unknown> }): Promise<void>
}

export interface ServiceContext {
  service: {
    id: number
    userId: number
    status: string
    quantity: number
    expiresAt: Date | null
    /** Data previously returned from `create()` (e.g. a server id). */
    properties: Record<string, unknown>
  }
  user: { id: number; uuid: string; email: string; username: string }
  product: { id: number; name: string; settings: Record<string, unknown> }
  /** Selected config options keyed by their environment variable (or option name). */
  configOptions: Record<string, string>
  /** Checkout fields the customer filled in. */
  checkoutConfig: Record<string, string>
  /** Settings saved for the extension. */
  settings: Record<string, unknown>
}

/** Provisioner extension, called when services change state. */
export interface Provisioner {
  /** Fields shown on the product edit page in the admin area. */
  productSettings?(): SettingField[] | Promise<SettingField[]>
  /** Fields the customer fills in at checkout (e.g. server name). */
  checkoutFields?(product: {
    id: number
    settings: Record<string, unknown>
  }): SettingField[] | Promise<SettingField[]>
  create(ctx: ServiceContext): Promise<Record<string, unknown> | undefined>
  suspend(ctx: ServiceContext): Promise<void>
  unsuspend(ctx: ServiceContext): Promise<void>
  terminate(ctx: ServiceContext): Promise<void>
  upgrade?(ctx: ServiceContext): Promise<void>
  /**
   * Called before an upgrade is invoiced with the context it would have
   * afterwards. Throw an Error with a customer friendly message to refuse it
   * (for example when the node has no room left).
   */
  checkUpgrade?(ctx: ServiceContext): Promise<void>
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
  /**
   * Handle requests to `/api/extensions/<id>/*` (webhooks, payment returns).
   * `path` is the part after the extension id, e.g. `/webhook`.
   */
  routes(handler: (request: Request, path: string) => Response | Promise<Response>): void
  /** Run a function on a cron expression. */
  schedule(cron: string, task: () => Promise<void>): void
  markInvoicePaid(
    invoiceId: number,
    transaction: { gateway: string; transactionId: string; amount: string; fee?: string },
  ): Promise<void>
  /** Looks up an invoice so gateways can verify amounts before marking it paid. */
  getInvoice(
    invoiceId: number,
  ): Promise<{ id: number; status: string; currency: string; total: string; userId: number } | null>
  /** Absolute URL of the panel without trailing slash. */
  url: string
  log: { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void }
}

export interface ServerExtension {
  /** Fields shown on the extension settings page in the admin area. */
  settings?: SettingField[]
  register?(api: ExtensionApi): void | Promise<void>
  gateway?: Gateway
  provisioner?: Provisioner
}

export const defineExtension = (ext: ServerExtension) => ext

// ── Web (browser) extensions ─────────────────────────────────────────────
// A web module is a plain ES module listed as `web` in extension.json. Its
// default export receives the panel's web API (also on `window.Ammonode`).

export type WebSlot =
  | 'dashboard.top'
  | 'dashboard.bottom'
  | 'server.console.sidebar'
  | 'server.tabs'
  | 'topbar.actions'
  | 'admin.dashboard'
  | (string & {})

export interface WebNavItem {
  id: string
  label: string
  /** Extension pages live under /x/<path> (client) or /admin/x/<path> (admin). */
  to: string
  area: 'client' | 'admin'
  icon?: unknown
  order?: number
  permission?: string
  requires?: string
}

export interface WebRegistry {
  addNavItem(item: WebNavItem): void
  addRoute(route: { path: string; area: 'client' | 'admin'; component: unknown }): void
  addSlot(slot: WebSlot, id: string, component: unknown, order?: number): void
  /** Replace a core component, e.g. `Sidebar` or `Topbar` (themes). */
  override(name: string, component: unknown): void
}

export interface AmmonodeWebApi {
  version: number
  /** The panel's React instance: always use this one, never bundle your own. */
  React: unknown
  jsx: unknown
  /** UI kit: Button, Card, CardHeader, Input, Field, Pill, Modal, Toggle, ... */
  ui: Record<string, unknown>
  api: {
    get<T>(path: string): Promise<T>
    post<T>(path: string, body?: unknown): Promise<T>
    patch<T>(path: string, body?: unknown): Promise<T>
    put<T>(path: string, body?: unknown): Promise<T>
    delete<T>(path: string, body?: unknown): Promise<T>
  }
  registry: WebRegistry
}

export type WebExtension = (api: AmmonodeWebApi) => void | Promise<void>
export const defineWebExtension = (fn: WebExtension) => fn
