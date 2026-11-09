import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CreditCard, LifeBuoy, Package, ReceiptText, Server, Users } from 'lucide-react'
import { Card, CardHeader, Empty, IconTile, Pill } from '../../components/ui'
import { Slot } from '../../extensions/registry'
import { api, formatDate, formatMoney } from '../../lib/api'

type Overview = {
  stats: {
    users: number
    servers: number
    activeServices: number
    pendingInvoices: number
    openTickets: number
    failedSetups: number
  }
  revenue: { currency: string; amount: string }[]
  mrr: { currency: string; amount: string }[]
  nodes: {
    id: number
    name: string
    memory: number
    disk: number
    online: boolean
    maintenance: boolean
    servers: number
    memoryUsed: number
    diskUsed: number
  }[]
  recent: {
    id: number
    event: string
    actor: string | null
    createdAt: string
    properties: Record<string, unknown>
  }[]
}

function Stat({
  icon,
  label,
  value,
  to,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  to?: string
}) {
  const body = (
    <div className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2/60 p-4 hover:border-subtle">
      <IconTile>{icon}</IconTile>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate text-xl font-medium leading-tight">{value}</p>
      </div>
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

function Bar({ used, total }: { used: number; total: number }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div
        className={`h-full rounded-full ${pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warn' : 'bg-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

const money = (list: { currency: string; amount: string }[]) =>
  list.length ? list.map((r) => formatMoney(r.amount, r.currency)).join(' · ') : formatMoney(0)

export function AdminOverviewPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<Overview>('/admin/overview'),
    refetchInterval: 60_000,
  })
  const s = data?.stats
  return (
    <>
      {!!s?.failedSetups && (
        <Link
          to="/admin/services"
          className="flex items-center gap-3 rounded-card border border-danger-line bg-danger-bg px-5 py-3 text-[13.5px] text-danger"
        >
          <AlertTriangle className="size-4" /> {s.failedSetups} paid service(s) could not be set up
          automatically. Review them now.
        </Link>
      )}
      <Card>
        <CardHeader title="Overview" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          <Stat
            icon={<CreditCard className="size-5" />}
            label="Revenue this month"
            value={data ? money(data.revenue) : '–'}
            to="/admin/invoices"
          />
          <Stat
            icon={<ReceiptText className="size-5" />}
            label="Monthly recurring revenue"
            value={data ? money(data.mrr) : '–'}
          />
          <Stat
            icon={<Package className="size-5" />}
            label="Active services"
            value={s?.activeServices ?? '–'}
            to="/admin/services"
          />
          <Stat icon={<Users className="size-5" />} label="Users" value={s?.users ?? '–'} to="/admin/users" />
          <Stat
            icon={<Server className="size-5" />}
            label="Servers"
            value={s?.servers ?? '–'}
            to="/admin/servers"
          />
          <Stat
            icon={<LifeBuoy className="size-5" />}
            label="Open tickets · unpaid invoices"
            value={s ? `${s.openTickets} · ${s.pendingInvoices}` : '–'}
          />
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Nodes" />
          <div className="space-y-3 px-5 pb-5">
            {data?.nodes.map((n) => (
              <div key={n.id} className="rounded-[12px] border border-line bg-surface-2 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">{n.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {n.servers} servers
                    {n.maintenance ? (
                      <Pill tone="warn">Maintenance</Pill>
                    ) : n.online ? (
                      <Pill tone="success" dot>
                        Online
                      </Pill>
                    ) : (
                      <Pill tone="danger" dot>
                        Offline
                      </Pill>
                    )}
                  </span>
                </div>
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="space-y-1">
                    <span className="text-muted">
                      Memory {Math.round((n.memoryUsed / 1024) * 10) / 10} /{' '}
                      {Math.round((n.memory / 1024) * 10) / 10} GiB
                    </span>
                    <Bar used={n.memoryUsed} total={n.memory} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted">
                      Disk {Math.round(n.diskUsed / 1024)} / {Math.round(n.disk / 1024)} GiB
                    </span>
                    <Bar used={n.diskUsed} total={n.disk} />
                  </div>
                </div>
              </div>
            ))}
            {data?.nodes.length === 0 && (
              <Empty title="No nodes yet">
                <Link to="/admin/nodes" className="underline">
                  Add your first node
                </Link>
              </Empty>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <div className="divide-y divide-line border-t border-line">
            {data?.recent.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <code className="flex-1 truncate text-xs">{r.event}</code>
                <span className="text-xs text-muted">{r.actor ?? 'System'}</span>
                <span className="w-32 text-right text-xs text-muted">{formatDate(r.createdAt, true)}</span>
              </div>
            ))}
            {data?.recent.length === 0 && <Empty title="Nothing yet" />}
          </div>
        </Card>
      </div>
      <Slot name="admin.dashboard" />
    </>
  )
}
