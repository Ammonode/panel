import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill } from '../../components/ui'
import { api, formatDate, formatMoney } from '../../lib/api'
import { invoiceTone, statusLabel } from '../billing/invoices'

type Tx = {
  id: number
  gateway: string
  transactionId: string | null
  amount: string
  status: string
  createdAt: string
}
type Detail = {
  data: {
    id: number
    number: string
    status: string
    currencyCode: string
    dueAt: string
    createdAt: string
    items: { id: number; description: string; total: string }[]
    transactions: Tx[]
    total: string
    paid: string
    remaining: string
  }
  billing: { customer: { id: number; name: string; email: string } | null }
}
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

export function AdminInvoicePage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['admin', 'invoice', id],
    queryFn: () => api.get<Detail>(`/admin/invoices/${id}`),
  })
  const [refund, setRefund] = useState<null | { tx: Tx; amount: string; method: string }>(null)
  const doRefund = useMutation({
    mutationFn: () =>
      api.post(`/admin/invoices/${id}/transactions/${refund!.tx.id}/refund`, {
        amount: refund!.amount,
        method: refund!.method,
      }),
    onSuccess: () => {
      setRefund(null)
      qc.invalidateQueries({ queryKey: ['admin', 'invoice', id] })
      qc.invalidateQueries({ queryKey: ['admin', 'invoices'] })
    },
  })
  if (error)
    return (
      <Card>
        <Empty title="Invoice not found" />
      </Card>
    )
  if (!data) return null
  const inv = data.data
  const refundedOf = (t: Tx) =>
    inv.transactions
      .filter((x) => x.transactionId === `refund-of:${t.id}`)
      .reduce((s, x) => s - Number(x.amount), 0)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="self-start">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-medium">
              Invoice {inv.number}{' '}
              <Pill tone={invoiceTone[inv.status as keyof typeof invoiceTone] ?? 'neutral'}>
                {statusLabel(inv.status)}
              </Pill>
            </h2>
            <p className="text-[13px] text-muted">
              Issued {formatDate(inv.createdAt)} · due {formatDate(inv.dueAt)}
            </p>
          </div>
          <a
            href={`/admin/invoices/${id}/print`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
          >
            <Printer className="size-4" /> Print / PDF
          </a>
        </div>
        <div className="divide-y divide-line border-t border-line">
          {inv.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-4 px-5 py-3 text-[13.5px]">
              <span className="whitespace-pre-line">{i.description}</span>
              <span className="font-medium">{formatMoney(i.total, inv.currencyCode)}</span>
            </div>
          ))}
        </div>
        <dl className="ml-auto max-w-xs space-y-1 p-5 text-[13.5px]">
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(inv.total, inv.currencyCode)}</dd>
          </div>
          <div className="flex justify-between text-muted">
            <dt>Paid</dt>
            <dd>{formatMoney(inv.paid, inv.currencyCode)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-medium">
            <dt>Due</dt>
            <dd>{formatMoney(inv.remaining, inv.currencyCode)}</dd>
          </div>
        </dl>
      </Card>
      <div className="space-y-4">
        {data.billing.customer && (
          <Card>
            <CardHeader title="Customer" />
            <div className="px-5 pb-5 text-[13px]">
              <Link
                to="/admin/users/$id"
                params={{ id: String(data.billing.customer.id) }}
                className="font-medium hover:underline"
              >
                {data.billing.customer.name}
              </Link>
              <p className="text-muted">{data.billing.customer.email}</p>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Payments" />
          <div className="divide-y divide-line border-t border-line">
            {inv.transactions.map((t) => (
              <div key={t.id} className="space-y-1 px-5 py-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="font-medium">
                    {t.gateway}
                    {t.status === 'refunded' && ' refund'}
                  </span>
                  <span>{formatMoney(t.amount, inv.currencyCode)}</span>
                </div>
                <p className="flex justify-between text-xs text-muted">
                  <span className="truncate">
                    {formatDate(t.createdAt, true)}
                    {t.transactionId && !t.transactionId.startsWith('refund-of')
                      ? ` · ${t.transactionId}`
                      : ''}
                  </span>
                  {t.status === 'succeeded' && Number(t.amount) > refundedOf(t) && (
                    <button
                      type="button"
                      className="text-fg underline"
                      onClick={() =>
                        setRefund({
                          tx: t,
                          amount: (Number(t.amount) - refundedOf(t)).toFixed(2),
                          method: t.gateway === 'stripe' || t.gateway === 'paypal' ? 'gateway' : 'credit',
                        })
                      }
                    >
                      Refund
                    </button>
                  )}
                </p>
              </div>
            ))}
            {inv.transactions.length === 0 && <Empty title="No payments yet" />}
          </div>
        </Card>
      </div>
      <Modal
        open={!!refund}
        onClose={() => setRefund(null)}
        title="Refund payment"
        footer={
          <>
            <Button variant="outline" onClick={() => setRefund(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={doRefund.isPending} onClick={() => doRefund.mutate()}>
              Refund
            </Button>
          </>
        }
      >
        {refund && (
          <div className="space-y-3 text-fg">
            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                value={refund.amount}
                onChange={(e) => setRefund({ ...refund, amount: e.target.value })}
              />
            </Field>
            <Field label="Refund to">
              <select
                className={selectClass}
                value={refund.method}
                onChange={(e) => setRefund({ ...refund, method: e.target.value })}
              >
                {(refund.tx.gateway === 'stripe' || refund.tx.gateway === 'paypal') && (
                  <option value="gateway">Original payment method ({refund.tx.gateway})</option>
                )}
                <option value="credit">Account credit</option>
                <option value="manual">Already refunded outside the panel</option>
              </select>
            </Field>
            <p className="text-xs text-muted">
              The service is not changed. Suspend or terminate it separately if needed.
            </p>
            {doRefund.error && <p className="text-danger">{doRefund.error.message}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
