import type { ComponentType, ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

/**
 * Runtime registry that extensions and themes use to add UI without rebuilding
 * the panel. Extensions get it as `window.Ammonode` (see packages/sdk/web).
 */
export type NavItem = {
  id: string
  label: string
  to: string
  icon?: ComponentType<{ className?: string }>
  area: 'client' | 'admin'
  section?: 'main' | 'bottom'
  order?: number
  permission?: string
}

export type ExtensionRoute = { path: string; area: 'client' | 'admin'; component: ComponentType }

/** Named places in the UI where extensions can inject components. */
export type SlotName =
  | 'dashboard.top'
  | 'dashboard.bottom'
  | 'server.console.sidebar'
  | 'server.tabs'
  | 'topbar.actions'
  | 'admin.dashboard'
  | (string & {})

type State = {
  nav: NavItem[]
  routes: ExtensionRoute[]
  slots: Record<string, { id: string; order: number; component: ComponentType<Record<string, unknown>> }[]>
  overrides: Record<string, ComponentType<Record<string, unknown>>>
}

let state: State = { nav: [], routes: [], slots: {}, overrides: {} }
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
const update = (fn: (s: State) => State) => {
  state = fn(state)
  emit()
}

export const registry = {
  addNavItem(item: NavItem) {
    update((s) => ({ ...s, nav: [...s.nav.filter((n) => n.id !== item.id), item] }))
  },
  addRoute(route: ExtensionRoute) {
    update((s) => ({
      ...s,
      routes: [...s.routes.filter((r) => r.path !== route.path || r.area !== route.area), route],
    }))
  },
  addSlot(slot: SlotName, id: string, component: ComponentType<Record<string, unknown>>, order = 0) {
    update((s) => ({
      ...s,
      slots: {
        ...s.slots,
        [slot]: [...(s.slots[slot] ?? []).filter((c) => c.id !== id), { id, order, component }],
      },
    }))
  },
  /** Themes can replace core components by name (e.g. `Sidebar`, `LoginPage`). */
  override(name: string, component: ComponentType<Record<string, unknown>>) {
    update((s) => ({ ...s, overrides: { ...s.overrides, [name]: component } }))
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => state,
}

export const useRegistry = () => useSyncExternalStore(registry.subscribe, registry.get)

export function Slot({ name, props }: { name: SlotName; props?: Record<string, unknown> }): ReactNode {
  const { slots } = useRegistry()
  const list = [...(slots[name] ?? [])].sort((a, b) => a.order - b.order)
  return list.map(({ id, component: C }) => <C key={id} {...props} />)
}

/** Renders a theme override when one is registered for `name`, otherwise the default. */
export function Overridable<P extends Record<string, unknown>>({
  name,
  fallback: Fallback,
  props,
}: {
  name: string
  fallback: ComponentType<P>
  props: P
}) {
  const { overrides } = useRegistry()
  const C = (overrides[name] as ComponentType<P> | undefined) ?? Fallback
  return <C {...props} />
}
