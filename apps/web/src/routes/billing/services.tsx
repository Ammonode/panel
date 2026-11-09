import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ExternalLink, Package } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, IconTile, Input, Modal, Pill } from '../../components/ui'
import { api, formatDate, formatMoney } from '../../lib/api'
import { invoiceTone, statusLabel } from './invoices'

type ServiceRow = {
  id: number
  product: string
  status: string
  price: string
  currency: string
  cycle: string
  expiresAt: string | null
}
type ServiceDetail = ServiceRow & {
  product: { id: number; name: string; description: string | null }
  configs: { name: string; value: string }[]
  loginUrl: string | null
  setupFailed: boolean
  cancellation: { type: string; reason: string | null; createdAt: string } | null
  invoices: { id: number; number: string; status: string; dueAt: string }[]
  createdAt: string
}

export const serviceTone = {
  active: 'success',
  pending: 'warn',
  suspended: 'danger',
  cancelled: 'neutral',
} as const

export function ServicesPage() {
  const { data } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<{ data: ServiceRow[] }>('/client/services'),
  })
  return (
    <Card>
      <CardHeader
        title="Services"
        action={
          <Link
            to="/store"
            className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            Order new
          </Link>
        }
      />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {data?.data.map((s) => (
          <Link
            key={s.id}
            to="/services/$id"
            params={{ id: String(s.id) }}
            className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2 p-4 hover:border-subtle"
          >
            <IconTile>
              <Package className="size-5" />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.product}</p>
              <p className="text-xs text-muted">
                {formatMoney(s.price, s.currency)} · {s.cycle}
                {s.expiresAt && ` · renews ${formatDate(s.expiresAt)}`}
              </p>
            </div>
            <Pill tone={serviceTone[s.status as keyof typeof serviceTone] ?? 'neutral'} dot>
              {statusLabel(s.status)}
            </Pill>
          </Link>
        ))}
      </div>
      {data?.data.length === 0 && (
        <Empty title="No services yet">
          <Link to="/store" className="text-fg underline">
            Visit the store
          </Link>
        </Empty>
      )}
    </Card>
  )
}

export function ServicePage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [type, setType] = useState<'end_of_period' | 'immediate'>('end_of_period')
  const [reason, setReason] = useState('')
  const { data, error } = useQuery({
    queryKey: ['service', id],
    queryFn: () => api.get<{ data: ServiceDetail }>(`/client/services/${id}`).then((r) => r.data),
  })
  const cancel = useMutation({
    mutationFn: () => api.post(`/client/services/${id}/cancel`, { type, reason }),
    onSuccess: () => {
      setCancelOpen(false)
      qc.invalidateQueries({ queryKey: ['service', id] })
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
  if (error)
    return (
      <Card>
        <Empty title="Service not found" />
      </Card>
    )
  if (!data) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="text-xl font-medium">{data.product.name}</h2>
              <p className="text-[13px] text-muted">Ordered {formatDate(data.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={serviceTone[data.status as keyof typeof serviceTone] ?? 'neutral'} dot>
                {statusLabel(data.status)}
              </Pill>
              {data.loginUrl && (
                <a
                  href={data.loginUrl}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
                >
                  Manage <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </div>
          {data.setupFailed && (
            <p className="mx-5 mb-4 rounded-[10px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
              Your payment was received. We could not finish setting up this service automatically, so our
              team has been notified and will complete it shortly.
            </p>
          )}
          {data.status === 'pending' && !data.setupFailed && (
            <p className="mx-5 mb-4 rounded-[10px] bg-info-bg px-4 py-3 text-[13px] text-info">
              This service will be activated as soon as its invoice is paid.
            </p>
          )}
          <dl className="grid gap-3 border-t border-line p-5 text-[13.5px] sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Price</dt>
              <dd className="font-medium">{formatMoney(data.price, data.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Billing cycle</dt>
              <dd className="font-medium">{data.cycle}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Next due date</dt>
              <dd className="font-medium">{data.expiresAt ? formatDate(data.expiresAt) : '—'}</dd>
            </div>
          </dl>
          {data.configs.length > 0 && (
            <dl className="grid gap-2 border-t border-line p-5 text-[13px] sm:grid-cols-2">
              {data.configs.map((c) => (
                <div key={c.name} className="flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-muted">{c.name}</dt>
                  <dd className="font-medium">{c.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <Card>
          <CardHeader title="Invoices" />
          <div className="divide-y divide-line border-t border-line">
            {data.invoices.map((i) => (
              <Link
                key={i.id}
                to="/invoices/$id"
                params={{ id: String(i.id) }}
                className="flex items-center justify-between px-5 py-3 text-[13.5px] hover:bg-surface-2"
              >
                <span className="font-medium">{i.number}</span>
                <span className="text-muted">{formatDate(i.dueAt)}</span>
                <Pill tone={invoiceTone[i.status as keyof typeof invoiceTone] ?? 'neutral'}>
                  {statusLabel(i.status)}
                </Pill>
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader title="Cancellation" />
        <div className="px-5 pb-5 text-[13px]">
          {data.cancellation ? (
            <p className="text-muted">
              Cancellation requested {formatDate(data.cancellation.createdAt)}
              {data.cancellation.type === 'end_of_period' && data.expiresAt
                ? `. The service ends on ${formatDate(data.expiresAt)}.`
                : '.'}
            </p>
          ) : data.status === 'cancelled' ? (
            <p className="text-muted">This service has been cancelled.</p>
          ) : (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              Request cancellation
            </Button>
          )}
        </div>
      </Card>
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel service"
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep service
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel service
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={type === 'end_of_period'}
              onChange={() => setType('end_of_period')}
            />{' '}
            At the end of the billing period
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={type === 'immediate'} onChange={() => setType('immediate')} />{' '}
            Immediately (the server and its files are deleted)
          </label>
          <Field label="Reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {cancel.error && <p className="text-danger">{cancel.error.message}</p>}
        </div>
      </Modal>
    </div>
  )
}
