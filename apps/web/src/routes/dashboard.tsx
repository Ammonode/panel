import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpDown,
  CirclePlus,
  Flame,
  Gamepad2,
  LifeBuoy,
  Package,
  ReceiptText,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import {
  ArcGauge,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Empty,
  IconTile,
  Input,
  Pill,
} from '../components/ui'
import { Slot } from '../extensions/registry'
import { api, formatDate, formatMoney } from '../lib/api'

type Ticket = { id: number; subject: string; status: string; updatedAt: string }
type Invoice = {
  id: number
  number: string | null
  status: string
  dueAt: string
  currencyCode: string
  total?: string
  description?: string
}
type Overview = {
  stats: { servers: number; services: number; invoicesDue: number }
  tickets: Ticket[]
  invoices: Invoice[]
}

const ticketTone = { open: 'warn', answered: 'info', replied: 'info', closed: 'neutral' } as const

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2/60 p-4">
      <IconTile>{icon}</IconTile>
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="text-xl font-medium leading-tight">{value}</p>
      </div>
    </div>
  )
}

function UsageRow({
  title,
  detail,
  value,
  warn,
}: {
  title: string
  detail: string
  value: number
  warn?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-[12px] border p-4 ${warn ? 'border-danger-line bg-danger-bg' : 'border-line bg-surface-2'}`}
    >
      <div>
        <p className="text-[15px] font-medium">{title}</p>
        <p className="text-xs text-muted">{detail}</p>
        {warn && (
          <span className="mt-2 inline-block rounded-md bg-danger px-2 py-1 text-[11px] font-medium text-white">
            Running low
          </span>
        )}
      </div>
      <ArcGauge value={value} tone={warn ? 'orange' : 'blue'} />
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/client/overview') })
  const stats = data?.stats
  const invoices = (data?.invoices ?? []).filter(
    (i) => !q || `${i.number} ${i.description ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  )
  const due = invoices.reduce((sum, i) => sum + Number(i.total ?? 0), 0)

  return (
    <>
      <Slot name="dashboard.top" />
      <Card>
        <CardHeader title="Overview" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={<Gamepad2 className="size-5" />} label="Game servers" value={stats?.servers ?? '–'} />
          <Stat
            icon={<Package className="size-5" />}
            label="Active services"
            value={stats?.services ?? '–'}
          />
          <Stat
            icon={<LifeBuoy className="size-5" />}
            label="Open tickets"
            value={data ? data.tickets.filter((t) => t.status !== 'closed').length : '–'}
          />
          <Stat
            icon={<ReceiptText className="size-5" />}
            label="Unpaid invoices"
            value={stats?.invoicesDue ?? '–'}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="flex flex-col">
          <CardHeader title="Resource usage" />
          <div className="flex-1 space-y-3 px-5 pb-5">
            <UsageRow title="Memory" detail="Across all your servers" value={0} />
            <UsageRow title="Disk" detail="Across all your servers" value={0} />
          </div>
          <CardFooter onClick={() => navigate({ to: '/services' })}>
            <Flame className="size-4 text-danger" /> Upgrade now
          </CardFooter>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Recent support tickets"
            action={
              <Button variant="outline" onClick={() => navigate({ to: '/tickets' })}>
                Create a ticket <CirclePlus className="size-[18px] stroke-[1.6]" />
              </Button>
            }
          />
          <div className="flex-1 space-y-2.5 px-5 pb-5">
            {data?.tickets.length === 0 && (
              <Empty title="No tickets yet">Need help? Our team usually replies within a few hours.</Empty>
            )}
            {data?.tickets.map((t) => (
              <Link
                key={t.id}
                to="/tickets"
                className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:border-subtle"
              >
                <span className="w-10 border-r border-line text-xs text-muted">#{t.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{t.subject}</span>
                  <span className="text-[11px] text-muted">Last update: {formatDate(t.updatedAt, true)}</span>
                </span>
                <Pill
                  dot={t.status !== 'closed'}
                  tone={ticketTone[t.status as keyof typeof ticketTone] ?? 'neutral'}
                >
                  {t.status[0]!.toUpperCase() + t.status.slice(1)}
                </Pill>
              </Link>
            ))}
          </div>
          <CardFooter onClick={() => navigate({ to: '/tickets' })}>See all</CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Invoices this month"
          subtitle="Payments are taken from your credit balance on the due date"
        />
        <div className="flex flex-wrap gap-3 px-5 pb-4">
          <Input
            className="min-w-56 flex-1"
            icon={<Search className="size-4" />}
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button variant="outline">
            <SlidersHorizontal className="size-4" /> Filters
          </Button>
          <Button disabled={!invoices.length}>Pay all · {formatMoney(due)}</Button>
        </div>
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-muted [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-normal">
                <th className="w-8 rounded-l-[10px]">
                  <input type="checkbox" aria-label="Select all" />
                </th>
                <th>Invoice</th>
                <th>Description</th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Due date <ArrowUpDown className="size-3" />
                  </span>
                </th>
                <th>
                  <span className="inline-flex items-center gap-1">
                    Amount <ArrowUpDown className="size-3" />
                  </span>
                </th>
                <th>Status</th>
                <th className="rounded-r-[10px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line last:border-0 [&>td]:px-3 [&>td]:py-3">
                  <td>
                    <input type="checkbox" aria-label={`Select ${inv.number}`} />
                  </td>
                  <td className="font-medium">{inv.number ?? `#${inv.id}`}</td>
                  <td>{inv.description ?? '—'}</td>
                  <td className="font-medium">{formatDate(inv.dueAt)}</td>
                  <td className="font-medium">{formatMoney(inv.total ?? 0, inv.currencyCode)}</td>
                  <td>
                    <Pill tone="info">Upcoming</Pill>
                  </td>
                  <td>
                    <Button variant="outline" size="sm">
                      Pay now
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !invoices.length && (
            <Empty title="You're all paid up">No invoices are due this month.</Empty>
          )}
        </div>
      </Card>
      <Slot name="dashboard.bottom" />
    </>
  )
}
