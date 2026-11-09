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
import { AdminEggsPage } from './routes/admin/eggs'
import { AdminLocationsPage, AdminNodesPage } from './routes/admin/nodes'
import { LoginPage, RegisterPage } from './routes/auth'
import { DashboardPage } from './routes/dashboard'
import { ConsolePage } from './routes/server/console'
import { FilesPage } from './routes/server/files'
import { ServerLayout } from './routes/server/layout'
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
      serverPage('/network', NetworkPage),
      serverPage('/settings', SettingsPage),
    ]),
    placeholder('/services', 'Services'),
    placeholder('/invoices', 'Billing'),
    placeholder('/credits', 'Top up credit'),
    placeholder('/tickets', 'Support'),
    placeholder('/account', 'Account'),
    placeholder('/account/security', 'Security'),
    placeholder('/help', 'Help'),
    placeholder('/admin', 'Admin overview'),
    placeholder('/admin/users', 'Users'),
    placeholder('/admin/servers', 'Servers'),
    page('/admin/nodes', AdminNodesPage),
    page('/admin/locations', AdminLocationsPage),
    page('/admin/eggs', AdminEggsPage),
    placeholder('/admin/products', 'Products'),
    placeholder('/admin/invoices', 'Invoices'),
    placeholder('/admin/tickets', 'Tickets'),
    placeholder('/admin/extensions', 'Extensions'),
    placeholder('/admin/settings', 'Settings'),
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
