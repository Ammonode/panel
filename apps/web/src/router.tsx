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
import {
  AdminCouponsPage,
  AdminExtensionsPage,
  AdminInvoicesPage,
  AdminServicesPage,
  AdminSettingsPage,
} from './routes/admin/billing'
import { AdminEggsPage } from './routes/admin/eggs'
import { AdminDatabaseHostsPage, AdminLocationsPage, AdminNodesPage } from './routes/admin/nodes'
import { AdminOverviewPage } from './routes/admin/overview'
import { AdminConfigOptionsPage, AdminProductEditPage, AdminProductsPage } from './routes/admin/products'
import { AdminServerPage, AdminServersPage } from './routes/admin/servers'
import { AdminRolesPage, AdminUserPage, AdminUsersPage } from './routes/admin/users'
import { LoginPage, RegisterPage } from './routes/auth'
import { CartPage } from './routes/billing/cart'
import { CreditsPage, InvoicePage, InvoicesPage } from './routes/billing/invoices'
import { ServicePage, ServicesPage } from './routes/billing/services'
import { CategoryPage, ProductPage, StorePage } from './routes/billing/store'
import { DashboardPage } from './routes/dashboard'
import { ConsolePage } from './routes/server/console'
import { FilesPage } from './routes/server/files'
import { ServerLayout } from './routes/server/layout'
import { ActivityPage, BackupsPage, DatabasesPage, SchedulesPage, UsersPage } from './routes/server/manage'
import { NetworkPage, SettingsPage } from './routes/server/settings'
import { StartupPage } from './routes/server/startup'
import { PlaceholderPage, ServersPage } from './routes/servers'

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet })

const guest = createRoute({
  getParentRoute: () => root,
  id: 'guest',
  component: Outlet,
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me.user) throw redirect({ to: '/' })
  },
})

const authed = createRoute({
  getParentRoute: () => root,
  id: 'app',
  component: AppLayout,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
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

const routeTree = root.addChildren([
  guest.addChildren([
    createRoute({ getParentRoute: () => guest, path: '/login', component: LoginPage }),
    createRoute({ getParentRoute: () => guest, path: '/register', component: RegisterPage }),
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
    placeholder('/tickets', 'Support'),
    placeholder('/account', 'Account'),
    placeholder('/account/security', 'Security'),
    placeholder('/help', 'Help'),
    page('/admin', AdminOverviewPage),
    page('/admin/users', AdminUsersPage),
    page('/admin/users/$id', AdminUserPage),
    page('/admin/roles', AdminRolesPage),
    page('/admin/servers', AdminServersPage),
    page('/admin/servers/$id', AdminServerPage),
    page('/admin/nodes', AdminNodesPage),
    page('/admin/locations', AdminLocationsPage),
    page('/admin/database-hosts', AdminDatabaseHostsPage),
    page('/admin/eggs', AdminEggsPage),
    page('/admin/products', AdminProductsPage),
    page('/admin/products/$id', AdminProductEditPage),
    page('/admin/config-options', AdminConfigOptionsPage),
    page('/admin/coupons', AdminCouponsPage),
    page('/admin/services', AdminServicesPage),
    page('/admin/invoices', AdminInvoicesPage),
    placeholder('/admin/tickets', 'Tickets'),
    page('/admin/extensions', AdminExtensionsPage),
    page('/admin/settings', AdminSettingsPage),
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
