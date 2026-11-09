import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Database,
  Egg,
  Gamepad2,
  LayoutGrid,
  LifeBuoy,
  MapPin,
  Moon,
  Package,
  PanelLeft,
  ReceiptText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Ticket,
  Users,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useCallback, useRef, useState } from 'react'
import { type NavItem, Overridable, Slot, useRegistry } from '../extensions/registry'
import { api, can, formatMoney, type User } from '../lib/api'
import { useMe, useUser } from '../lib/auth'
import { useDismiss } from '../lib/hooks'
import { useThemeMode } from '../lib/theme'
import { Button, cn, Input, Toggle } from './ui'

const clientNav: NavItem[] = [
  { id: 'dashboard', label: 'Control Panel', to: '/', icon: LayoutGrid, area: 'client' },
  { id: 'servers', label: 'Servers', to: '/servers', icon: Gamepad2, area: 'client' },
  { id: 'services', label: 'Services', to: '/services', icon: Package, area: 'client' },
  { id: 'store', label: 'Store', to: '/store', icon: ShoppingBag, area: 'client' },
  { id: 'invoices', label: 'Billing', to: '/invoices', icon: CreditCard, area: 'client' },
  { id: 'security', label: 'Security', to: '/account/security', icon: ShieldCheck, area: 'client' },
  { id: 'support', label: 'Support', to: '/tickets', icon: LifeBuoy, area: 'client' },
]

const adminNav: NavItem[] = [
  {
    id: 'admin',
    label: 'Overview',
    to: '/admin',
    icon: LayoutGrid,
    area: 'admin',
    permission: 'admin.dashboard',
  },
  {
    id: 'admin-users',
    label: 'Users',
    to: '/admin/users',
    icon: Users,
    area: 'admin',
    permission: 'admin.users.view',
  },
  {
    id: 'admin-servers',
    label: 'Servers',
    to: '/admin/servers',
    icon: Server,
    area: 'admin',
    permission: 'admin.servers.view',
  },
  {
    id: 'admin-nodes',
    label: 'Nodes',
    to: '/admin/nodes',
    icon: Server,
    area: 'admin',
    permission: 'admin.nodes.manage',
  },
  {
    id: 'admin-locations',
    label: 'Locations',
    to: '/admin/locations',
    icon: MapPin,
    area: 'admin',
    permission: 'admin.locations.manage',
  },
  {
    id: 'admin-databases',
    label: 'Databases',
    to: '/admin/database-hosts',
    icon: Database,
    area: 'admin',
    permission: 'admin.databases.manage',
  },
  {
    id: 'admin-eggs',
    label: 'Nests & Eggs',
    to: '/admin/eggs',
    icon: Egg,
    area: 'admin',
    permission: 'admin.nests.manage',
  },
  {
    id: 'admin-products',
    label: 'Products',
    to: '/admin/products',
    icon: Package,
    area: 'admin',
    permission: 'admin.products.manage',
  },
  {
    id: 'admin-services',
    label: 'Services',
    to: '/admin/services',
    icon: Package,
    area: 'admin',
    permission: 'admin.orders.view',
  },
  {
    id: 'admin-coupons',
    label: 'Coupons',
    to: '/admin/coupons',
    icon: Ticket,
    area: 'admin',
    permission: 'admin.coupons.manage',
  },
  {
    id: 'admin-invoices',
    label: 'Invoices',
    to: '/admin/invoices',
    icon: ReceiptText,
    area: 'admin',
    permission: 'admin.invoices.view',
  },
  {
    id: 'admin-tickets',
    label: 'Tickets',
    to: '/admin/tickets',
    icon: LifeBuoy,
    area: 'admin',
    permission: 'admin.tickets.view',
  },
  {
    id: 'admin-extensions',
    label: 'Extensions',
    to: '/admin/extensions',
    icon: SlidersHorizontal,
    area: 'admin',
    permission: 'admin.extensions.manage',
  },
]

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon as ComponentType<{ className?: string }> | undefined
  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors',
        active ? 'bg-nav text-nav-fg' : 'text-fg hover:bg-surface',
      )}
    >
      {Icon && <Icon className="size-[18px] stroke-[1.6]" />}
      {item.label}
    </Link>
  )
}

function Sidebar({
  user,
  collapsed,
  onCollapse,
}: {
  user: User
  collapsed: boolean
  onCollapse: () => void
}) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const { nav: extNav } = useRegistry()
  const { isDark, setMode } = useThemeMode()
  const area = path.startsWith('/admin') ? 'admin' : 'client'
  const items = [
    ...(area === 'admin' ? adminNav : clientNav),
    ...extNav.filter((n) => n.area === area && n.section !== 'bottom'),
  ]
    .filter((n) => !n.permission || can(user, n.permission))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const isActive = (to: string) =>
    (to === '/servers' && path.startsWith('/server/')) ||
    (to === '/' || to === '/admin' ? path === to : path === to || path.startsWith(`${to}/`))

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-line bg-canvas px-3 py-5 transition-transform lg:translate-x-0',
        collapsed ? '-translate-x-full' : 'translate-x-0',
      )}
    >
      <div className="mb-6 flex items-center justify-between px-2">
        <Link to="/" className="flex items-center gap-2 text-[19px] font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="size-6" />
          ammonode
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          className="rounded-md p-1 text-muted hover:bg-surface"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="size-[18px] stroke-[1.6]" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink key={item.id} item={item} active={isActive(item.to)} />
        ))}
      </nav>

      <div className="space-y-1 border-b border-line pb-4">
        {user.isAdmin && (
          <NavLink
            item={
              area === 'admin'
                ? { id: 'to-client', label: 'Client area', to: '/', icon: LayoutGrid, area }
                : { id: 'to-admin', label: 'Admin', to: '/admin', icon: ShieldCheck, area }
            }
            active={false}
          />
        )}
        <NavLink
          item={{
            id: 'settings',
            label: 'Settings',
            to: area === 'admin' ? '/admin/settings' : '/account',
            icon: Settings,
            area,
          }}
          active={isActive(area === 'admin' ? '/admin/settings' : '/account')}
        />
        <NavLink
          item={{ id: 'help', label: 'Help', to: '/help', icon: CircleHelp, area }}
          active={isActive('/help')}
        />
      </div>
      <div className="flex items-center justify-between px-3 pt-4 text-[13.5px]">
        <span className="flex items-center gap-3">
          <Moon className="size-[18px] stroke-[1.6]" /> Dark theme
        </span>
        <Toggle checked={isDark} onChange={(v) => setMode(v ? 'dark' : 'light')} label="Dark theme" />
      </div>
    </aside>
  )
}

function Avatar({ user }: { user: User }) {
  const initials = (user.firstName?.[0] ?? user.username[0] ?? '?') + (user.lastName?.[0] ?? '')
  return (
    <span className="icon-tile grid size-10 place-items-center rounded-full text-sm font-medium uppercase text-white">
      {initials}
    </span>
  )
}

function Topbar({ user, onMenu }: { user: User; onMenu: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  useDismiss(menuRef, menu, closeMenu)
  const balance = Object.entries(user.credits)[0]
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-surface/90 px-5 py-3.5 backdrop-blur lg:px-6">
      <button
        type="button"
        onClick={onMenu}
        className="rounded-md p-1 text-muted hover:bg-surface-2 lg:hidden"
        aria-label="Open menu"
      >
        <PanelLeft className="size-5" />
      </button>
      <h1 className="mr-auto text-lg font-medium">Welcome back, {user.firstName ?? user.username}</h1>
      <Slot name="topbar.actions" />
      <span className="hidden text-[15px] font-medium sm:inline">
        {formatMoney(balance?.[1] ?? 0, balance?.[0] ?? 'USD')}
      </span>
      <div className="flex">
        <Button size="md" className="rounded-r-none pr-3" onClick={() => navigate({ to: '/credits' })}>
          Top up
        </Button>
        <Button
          size="md"
          className="rounded-l-none border-l border-white/15 px-2.5"
          aria-label="More"
          onClick={() => navigate({ to: '/invoices' })}
        >
          <ChevronDown className="size-4" />
        </Button>
      </div>
      <Input className="hidden w-52 md:block" icon={<Search className="size-4" />} placeholder="Search" />
      <NotificationBell />
      <div className="relative" ref={menuRef}>
        <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Account menu">
          <Avatar user={user} />
        </button>
        {menu && (
          <div className="absolute right-0 mt-2 w-48 rounded-[12px] border border-line bg-surface p-1.5 shadow-lg">
            <p className="truncate px-2.5 py-1.5 text-xs text-muted">{user.email}</p>
            <Link to="/account" className="block rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2">
              Account
            </Link>
            <button
              type="button"
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-danger hover:bg-surface-2"
              onClick={async () => {
                await api.post('/auth/logout')
                await qc.invalidateQueries()
                navigate({ to: '/login' })
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

type Notification = {
  id: number
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(bellRef, open, close)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: Notification[]; unread: number }>('/client/notifications'),
    refetchInterval: 60_000,
  })
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && data?.unread) {
      await api.post('/client/notifications/read')
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
  }
  return (
    <div className="relative" ref={bellRef}>
      <button
        type="button"
        onClick={toggle}
        className="relative grid size-10 place-items-center rounded-[10px] border border-line hover:bg-surface-2"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="size-[18px] stroke-[1.6]" />
        {!!data?.unread && <span className="absolute top-2 right-2.5 size-2 rounded-full bg-red-500" />}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-[12px] border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-4 py-2.5 text-[13px] font-medium">Notifications</p>
          <div className="max-h-96 overflow-y-auto">
            {data?.data.map((n) => (
              <button
                type="button"
                key={n.id}
                className="block w-full border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-surface-2"
                onClick={() => {
                  setOpen(false)
                  if (n.url) navigate({ to: n.url })
                }}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                  {n.title}
                </span>
                {n.body && <span className="block text-xs text-muted">{n.body}</span>}
                <span className="block text-[11px] text-subtle">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
            {data?.data.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-muted">You are all caught up.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Asks the user to confirm their email address. */
function VerifyBanner() {
  const user = useUser()
  const resend = useMutation({ mutationFn: () => api.post('/account/verification') })
  if (!user || user.emailVerified) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-info-bg px-5 py-3 text-[13.5px] text-info">
      Please confirm your email address. We sent a link to {user.email}.
      <Button
        size="sm"
        variant="outline"
        loading={resend.isPending}
        disabled={resend.isSuccess}
        onClick={() => resend.mutate()}
      >
        {resend.isSuccess ? 'Sent' : 'Resend link'}
      </Button>
    </div>
  )
}

/** Shown while an administrator is signed in as a customer. */
function ImpersonationBanner() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  if (!me.data?.impersonating) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn/30 bg-warn-bg px-5 py-3 text-[13.5px] text-warn">
      You are signed in as {me.data.user?.email}. Everything you do is logged.
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await api.post('/auth/impersonate/stop')
          await qc.invalidateQueries()
          navigate({ to: '/admin/users' })
        }}
      >
        Return to my account
      </Button>
    </div>
  )
}

export function AppLayout() {
  const user = useUser()
  const [collapsed, setCollapsed] = useState(true)
  if (!user) return null
  return (
    <div className="min-h-dvh">
      <Overridable
        name="Sidebar"
        fallback={Sidebar}
        props={{ user, collapsed, onCollapse: () => setCollapsed((c) => !c) }}
      />
      {!collapsed && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}
      <div className="lg:pl-[248px]">
        <div className="min-h-dvh lg:p-3 lg:pl-0">
          <div className="min-h-[calc(100dvh-24px)] bg-canvas lg:rounded-[18px] lg:border lg:border-line">
            <Overridable
              name="Topbar"
              fallback={Topbar}
              props={{ user, onMenu: () => setCollapsed(false) }}
            />
            <main className="space-y-4 p-4 lg:p-5">
              <ImpersonationBanner />
              <VerifyBanner />
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}
