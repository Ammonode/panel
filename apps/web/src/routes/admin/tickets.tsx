import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, cn, Empty, Input, Modal, Pill } from '../../components/ui'
import { api, formatDate } from '../../lib/api'
import { postMessage, priorityTone, ReplyBox, Thread, type TicketMessage, ticketTone } from '../tickets'

type Row = {
  id: number
  subject: string
  status: string
  priority: string
  updatedAt: string
  department: string | null
  customer: { email: string }
  assignedTo: number | null
}
type Detail = Row & {
  departmentId: number | null
  createdAt: string
  customer: { id: number; email: string; username: string; firstName: string | null; lastName: string | null }
  services: { id: number; status: string; product: string }[]
  staff: { id: number; username: string }[]
  messages: TicketMessage[]
}
const selectClass = 'h-9 w-full rounded-[10px] border border-line bg-surface px-2 text-[13px]'
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export function AdminTicketsPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('active')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [depts, setDepts] = useState(false)
  const [deptName, setDeptName] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useQuery({
    queryKey: ['admin', 'tickets', status, search],
    queryFn: () =>
      api.get<{ data: Row[] }>(`/admin/tickets?status=${status}&q=${encodeURIComponent(search)}`),
    refetchInterval: 30_000,
  })
  const departments = useQuery({
    queryKey: ['admin', 'ticket-departments'],
    enabled: depts,
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/admin/ticket-departments'),
  })
  const addDept = useMutation({
    mutationFn: () => api.post('/admin/ticket-departments', { name: deptName }),
    onSuccess: () => {
      setDeptName('')
      qc.invalidateQueries({ queryKey: ['admin', 'ticket-departments'] })
    },
  })
  const delDept = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/ticket-departments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'ticket-departments'] }),
  })
  const filters = [
    ['active', 'Active'],
    ['replied', 'Awaiting staff'],
    ['answered', 'Answered'],
    ['closed', 'Closed'],
    ['', 'All'],
  ] as const
  return (
    <Card>
      <CardHeader
        title="Tickets"
        action={
          <Button variant="outline" onClick={() => setDepts(true)}>
            Departments
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3 px-5 pb-4">
        <div className="flex gap-1">
          {filters.map(([v, label]) => (
            <button
              type="button"
              key={label}
              onClick={() => setStatus(v)}
              className={cn(
                'rounded-[10px] px-3 py-2 text-[13px]',
                status === v ? 'bg-nav text-nav-fg' : 'border border-line hover:bg-surface-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          className="min-w-56 flex-1"
          icon={<Search className="size-4" />}
          placeholder="Search subject or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((t) => (
          <Link
            key={t.id}
            to="/admin/tickets/$id"
            params={{ id: String(t.id) }}
            className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-surface-2"
          >
            <span className="w-10 text-xs text-muted">#{t.id}</span>
            <span className="min-w-48 flex-1">
              <span className="font-medium">{t.subject}</span>
              <span className="block text-xs text-muted">
                {t.customer.email} · {t.department ?? 'General'}
              </span>
            </span>
            <Pill tone={priorityTone[t.priority as keyof typeof priorityTone] ?? 'neutral'}>
              {cap(t.priority)}
            </Pill>
            <Pill
              tone={ticketTone[t.status as keyof typeof ticketTone] ?? 'neutral'}
              dot={t.status !== 'closed'}
            >
              {t.status === 'replied' ? 'Customer replied' : cap(t.status)}
            </Pill>
            <span className="w-36 text-right text-xs text-muted">{formatDate(t.updatedAt, true)}</span>
          </Link>
        ))}
        {data?.data.length === 0 && <Empty title="No tickets here" />}
      </div>
      <Modal open={depts} onClose={() => setDepts(false)} title="Departments">
        <div className="space-y-2 text-fg">
          {departments.data?.data.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-[13px]">
              {d.name}
              <Button size="sm" variant="ghost" onClick={() => delDept.mutate(d.id)}>
                Remove
              </Button>
            </div>
          ))}
          <form
            className="flex gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              addDept.mutate()
            }}
          >
            <Input
              className="flex-1"
              placeholder="New department"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
            />
            <Button type="submit" disabled={!deptName}>
              Add
            </Button>
          </form>
        </div>
      </Modal>
    </Card>
  )
}

export function AdminTicketPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['admin', 'ticket', id],
    queryFn: () => api.get<{ data: Detail }>(`/admin/tickets/${id}`).then((r) => r.data),
    refetchInterval: 30_000,
  })
  const departments = useQuery({
    queryKey: ['admin', 'ticket-departments'],
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/admin/ticket-departments'),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'ticket', id] })
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/admin/tickets/${id}`, body),
    onSuccess: refresh,
  })
  if (error)
    return (
      <Card>
        <Empty title="Ticket not found" />
      </Card>
    )
  if (!data) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Card>
          <div className="p-5">
            <h2 className="text-xl font-medium">{data.subject}</h2>
            <p className="text-[13px] text-muted">
              #{data.id} · opened {formatDate(data.createdAt, true)}
            </p>
          </div>
        </Card>
        <Thread messages={data.messages} base={`/admin/tickets/${id}`} viewerIsStaff />
        <Card className="p-5">
          <ReplyBox
            extra="Reply & close"
            onSend={async (message, files, close) => {
              await postMessage(
                `/admin/tickets/${id}/reply`,
                { message, close: close ? 'true' : 'false' },
                files,
              )
              await refresh()
            }}
          />
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Ticket" />
          <div className="space-y-3 px-5 pb-5 text-[13px]">
            {[
              [
                'Status',
                'status',
                ['open', 'answered', 'replied', 'closed'].map((s) => [
                  s,
                  s === 'replied' ? 'Customer replied' : cap(s),
                ]),
              ],
              ['Priority', 'priority', ['low', 'medium', 'high'].map((s) => [s, cap(s)])],
            ].map(([label, key, options]) => (
              <label key={key as string} className="block space-y-1">
                <span className="text-muted">{label as string}</span>
                <select
                  className={selectClass}
                  value={String(data[key as 'status'])}
                  onChange={(e) => update.mutate({ [key as string]: e.target.value })}
                >
                  {(options as string[][]).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-muted">Department</span>
              <select
                className={selectClass}
                value={data.departmentId ?? ''}
                onChange={(e) =>
                  update.mutate({ departmentId: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">General</option>
                {departments.data?.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-muted">Assigned to</span>
              <select
                className={selectClass}
                value={data.assignedTo ?? ''}
                onChange={(e) =>
                  update.mutate({ assignedTo: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Nobody</option>
                {data.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.username}
                  </option>
                ))}
              </select>
            </label>
            {update.error && <p className="text-danger">{update.error.message}</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Customer" />
          <div className="space-y-2 px-5 pb-5 text-[13px]">
            <Link
              to="/admin/users/$id"
              params={{ id: String(data.customer.id) }}
              className="block font-medium hover:underline"
            >
              {[data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ') ||
                data.customer.username}
            </Link>
            <p className="text-muted">{data.customer.email}</p>
            {data.services.map((s) => (
              <p key={s.id} className="flex justify-between text-xs">
                <span>
                  #{s.id} {s.product}
                </span>
                <span className="text-muted">{s.status}</span>
              </p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
