import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { AppLayout } from './components/layout'
import { meQuery } from './lib/auth'
import { AccountPage, SecurityPage } from './routes/account'
import {
  AdminCouponsPage,
  AdminExtensionsPage,
  AdminInvoicesPage,
  AdminServicesPage,
  AdminSettingsPage,
} from './routes/admin/billing'
import { AdminAnnouncementsPage } from './routes/admin/content'
import { AdminEggEditPage } from './routes/admin/egg-edit'
import { AdminEggsPage } from './routes/admin/eggs'
import { AdminInvoicePage } from './routes/admin/invoice'
import { AdminMailPage } from './routes/admin/mail'
import { AdminNodePage } from './routes/admin/node-edit'
import { AdminDatabaseHostsPage, AdminLocationsPage, AdminNodesPage } from './routes/admin/nodes'
import { AdminOverviewPage } from './routes/admin/overview'
import { AdminConfigOptionsPage, AdminProductEditPage, AdminProductsPage } from './routes/admin/products'
import { AdminServerPage, AdminServersPage } from './routes/admin/servers'
import { AdminTicketPage, AdminTicketsPage } from './routes/admin/tickets'
import { AdminRolesPage, AdminUserPage, AdminUsersPage } from './routes/admin/users'
import { AffiliatePage } from './routes/affiliate'
import { AnnouncementsPage } from './routes/announcements'
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './routes/auth'
import { CartPage } from './routes/billing/cart'
import { AdminInvoicePrintPage, InvoicePrintPage } from './routes/billing/invoice-print'
import { CreditsPage, InvoicePage, InvoicesPage } from './routes/billing/invoices'
import { ServicePage, ServicesPage } from './routes/billing/services'
import { CategoryPage, ProductPage, StorePage } from './routes/billing/store'
import { DashboardPage } from './routes/dashboard'
import { ExtensionPage } from './routes/extension-page'
import { ConsolePage } from './routes/server/console'
import { FilesPage } from './routes/server/files'
import { ServerLayout } from './routes/server/layout'
import { ActivityPage, BackupsPage, DatabasesPage, SchedulesPage, UsersPage } from './routes/server/manage'
import { NetworkPage, SettingsPage } from './routes/server/settings'
import { StartupPage } from './routes/server/startup'
import { PlaceholderPage, ServersPage } from './routes/servers'
import { NewTicketPage, TicketPage, TicketsPage } from './routes/tickets'

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet })

const guest = createRoute({
  getParentRoute: () => root,
  id: 'guest',
  component: Outlet,
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(meQuery)
    if (me.user) throw redirect({ to: '/' })
  },
})

const authed = createRoute({
  getParentRoute: () => root,
  id: 'app',
  component: AppLayout,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery)
    if (!me.user) throw redirect({ to: '/login', search: { redirect: location.href } })
    if (location.pathname.startsWith('/admin') && !me.user.isAdmin) throw redirect({ to: '/' })
  },
})

const page = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => authed, path, component })
const placeholder = (path: string, title: string) => page(path, () => <PlaceholderPage title={title} />)

const serverRoute = createRoute({
  getParentRoute: () => authed,
  path: '/server/$id',
  component: ServerLayout,
})
const serverPage = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => serverRoute, path, component })

// Print pages render without the app chrome but still require a session.
const printRoot = createRoute({
  getParentRoute: () => root,
  id: 'print',
  component: Outlet,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery)
    if (!me.user) throw redirect({ to: '/login', search: { redirect: location.href } })
  },
})

const verifyRoute = createRoute({
  getParentRoute: () => root,
  path: '/verify-email',
  component: VerifyEmailPage,
})

const routeTree = root.addChildren([
  verifyRoute,
  printRoot.addChildren([
    createRoute({
      getParentRoute: () => printRoot,
      path: '/invoices/$id/print',
      component: InvoicePrintPage,
    }),
    createRoute({
      getParentRoute: () => printRoot,
      path: '/admin/invoices/$id/print',
      component: AdminInvoicePrintPage,
    }),
  ]),
  guest.addChildren([
    createRoute({ getParentRoute: () => guest, path: '/login', component: LoginPage }),
    createRoute({ getParentRoute: () => guest, path: '/register', component: RegisterPage }),
    createRoute({ getParentRoute: () => guest, path: '/forgot-password', component: ForgotPasswordPage }),
    createRoute({ getParentRoute: () => guest, path: '/reset-password', component: ResetPasswordPage }),
  ]),
  authed.addChildren([
    page('/', DashboardPage),
    page('/servers', ServersPage),
    serverRoute.addChildren([
      serverPage('/', ConsolePage),
      serverPage('/files', FilesPage),
      serverPage('/startup', StartupPage),
      serverPage('/schedules', SchedulesPage),
      serverPage('/users', UsersPage),
      serverPage('/databases', DatabasesPage),
      serverPage('/backups', BackupsPage),
      serverPage('/activity', ActivityPage),
      serverPage('/network', NetworkPage),
      serverPage('/settings', SettingsPage),
    ]),
    page('/store', StorePage),
    page('/store/$category', CategoryPage),
    page('/store/product/$slug', ProductPage),
    page('/cart', CartPage),
    page('/services', ServicesPage),
    page('/services/$id', ServicePage),
    page('/invoices', InvoicesPage),
    page('/invoices/$id', InvoicePage),
    page('/credits', CreditsPage),
    page('/tickets', TicketsPage),
    page('/tickets/new', NewTicketPage),
    page('/tickets/$id', TicketPage),
    page('/account', AccountPage),
    page('/account/security', SecurityPage),
    placeholder('/help', 'Help'),
    page('/admin', AdminOverviewPage),
    page('/admin/users', AdminUsersPage),
    page('/admin/users/$id', AdminUserPage),
    page('/admin/roles', AdminRolesPage),
    page('/admin/servers', AdminServersPage),
    page('/admin/servers/$id', AdminServerPage),
    page('/admin/nodes', AdminNodesPage),
    page('/admin/nodes/$id', AdminNodePage),
    page('/admin/locations', AdminLocationsPage),
    page('/admin/database-hosts', AdminDatabaseHostsPage),
    page('/admin/eggs', AdminEggsPage),
    page('/admin/eggs/$id', AdminEggEditPage),
    page('/admin/products', AdminProductsPage),
    page('/admin/products/$id', AdminProductEditPage),
    page('/admin/config-options', AdminConfigOptionsPage),
    page('/admin/coupons', AdminCouponsPage),
    page('/admin/services', AdminServicesPage),
    page('/admin/invoices', AdminInvoicesPage),
    page('/admin/invoices/$id', AdminInvoicePage),
    page('/admin/tickets', AdminTicketsPage),
    page('/admin/tickets/$id', AdminTicketPage),
    page('/admin/extensions', AdminExtensionsPage),
    page('/admin/settings', AdminSettingsPage),
    page('/admin/settings/email', AdminMailPage),
    page('/admin/announcements', AdminAnnouncementsPage),
    page('/announcements', AnnouncementsPage),
    page('/affiliate', AffiliatePage),
    page('/x/$', () => <ExtensionPage area="client" />),
    page('/admin/x/$', () => <ExtensionPage area="admin" />),
  ]),
])

export function makeRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
