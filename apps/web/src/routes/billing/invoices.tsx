import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { CheckCircle2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Pill } from '../../components/ui'
import { api, formatDate, formatMoney } from '../../lib/api'
import { useUser } from '../../lib/auth'

type InvoiceRow = {
  id: number
  number: string | null
  status: string
  dueAt: string
  paidAt: string | null
  currencyCode: string
  total: string
  description: string | null
}
type InvoiceDetail = InvoiceRow & {
  items: { id: number; description: string; price: string; quantity: number; total: string }[]
  transactions: {
    id: number
    gateway: string
    transactionId: string | null
    amount: string
    createdAt: string
  }[]
  paid: string
  remaining: string
  createdAt: string
}

export const invoiceTone = {
  pending: 'warn',
  paid: 'success',
  cancelled: 'neutral',
  refunded: 'info',
} as const
export const statusLabel = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export function InvoicesPage() {
  const { data } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<{ data: InvoiceRow[] }>('/client/invoices'),
  })
  return (
    <Card>
      <CardHeader
        title="Invoices"
        action={
          <Link
            to="/credits"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
          >
            <Wallet className="size-4" /> Add credit
          </Link>
        }
      />
      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-muted [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-normal">
              <th className="rounded-l-[10px]">Invoice</th>
              <th>Description</th>
              <th>Due date</th>
              <th>Amount</th>
              <th className="rounded-r-[10px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0 [&>td]:px-3 [&>td]:py-3">
                <td>
                  <Link
                    to="/invoices/$id"
                    params={{ id: String(i.id) }}
                    className="font-medium hover:underline"
                  >
                    {i.number ?? `#${i.id}`}
                  </Link>
                </td>
                <td className="max-w-72 truncate">{i.description ?? '—'}</td>
                <td>{formatDate(i.dueAt)}</td>
                <td className="font-medium">{formatMoney(i.total, i.currencyCode)}</td>
                <td>
                  <Pill tone={invoiceTone[i.status as keyof typeof invoiceTone] ?? 'neutral'}>
                    {statusLabel(i.status)}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.data.length === 0 && <Empty title="No invoices yet" />}
      </div>
    </Card>
  )
}

export function InvoicePage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const user = useUser()
  const qc = useQueryClient()
  const justPaid = new URLSearchParams(location.search).has('paid')
  const { data, error } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<{ data: InvoiceDetail }>(`/client/invoices/${id}`).then((r) => r.data),
    // After returning from a payment provider the webhook may still be on its way.
    refetchInterval: (q) => (justPaid && q.state.data?.status === 'pending' ? 3000 : false),
  })
  const gateways = useQuery({
    queryKey: ['gateways'],
    queryFn: () => api.get<{ data: { id: string; label: string }[] }>('/store/gateways'),
  })
  const pay = useMutation({
    mutationFn: (gateway: string) =>
      api.post<{ data: { redirect?: string; html?: string; paid?: boolean } }>(`/client/invoices/${id}/pay`, {
        gateway,
      }),
    onSuccess: ({ data: r }) => {
      if (r.redirect) window.location.href = r.redirect
      qc.invalidateQueries({ queryKey: ['invoice', id] })
      qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
  if (error)
    return (
      <Card>
        <Empty title="Invoice not found" />
      </Card>
    )
  if (!data) return null
  const balance = Number(user?.credits[data.currencyCode] ?? 0)
  const isCredit = data.items.some((i) => i.description === 'Account credit')

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="self-start">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div>
            <h2 className="text-xl font-medium">Invoice {data.number}</h2>
            <p className="text-[13px] text-muted">
              Issued {formatDate(data.createdAt)} · Due {formatDate(data.dueAt)}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <a
              href={`/invoices/${data.id}/print`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[13px] hover:bg-surface-2"
            >
              Download PDF
            </a>
            <Pill tone={invoiceTone[data.status as keyof typeof invoiceTone] ?? 'neutral'}>
              {statusLabel(data.status)}
            </Pill>
          </span>
        </div>
        <div className="overflow-x-auto px-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-muted [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-normal">
                <th className="rounded-l-[10px]">Description</th>
                <th className="text-right">Qty</th>
                <th className="rounded-r-[10px] text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-line [&>td]:px-3 [&>td]:py-3">
                  <td className="whitespace-pre-line">{i.description}</td>
                  <td className="text-right">{i.quantity}</td>
                  <td className="text-right font-medium">{formatMoney(i.total, data.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1.5 p-5 text-[13.5px]">
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd>{formatMoney(data.total, data.currencyCode)}</dd>
          </div>
          {Number(data.paid) > 0 && (
            <div className="flex justify-between text-muted">
              <dt>Paid</dt>
              <dd>−{formatMoney(data.paid, data.currencyCode)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 text-base font-medium">
            <dt>Amount due</dt>
            <dd>{formatMoney(data.remaining, data.currencyCode)}</dd>
          </div>
        </dl>
        {data.transactions.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <p className="mb-2 text-[13px] font-medium">Transactions</p>
            {data.transactions.map((t) => (
              <p key={t.id} className="flex justify-between text-xs text-muted">
                <span>
                  {formatDate(t.createdAt, true)} · {t.gateway}
                  {t.transactionId ? ` · ${t.transactionId}` : ''}
                </span>
                <span>{formatMoney(t.amount, data.currencyCode)}</span>
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card className="self-start">
        {data.status === 'paid' ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="font-medium">Paid {data.paidAt && formatDate(data.paidAt)}</p>
            <Link to="/services" className="text-[13px] text-muted underline">
              Go to your services
            </Link>
          </div>
        ) : data.status === 'pending' ? (
          <>
            <CardHeader
              title="Pay invoice"
              subtitle={justPaid ? 'Waiting for the payment confirmation…' : undefined}
            />
            <div className="space-y-2 px-5 pb-5">
              {!isCredit && balance > 0 && (
                <Button
                  className="w-full"
                  variant="outline"
                  loading={pay.isPending && pay.variables === 'credits'}
                  onClick={() => pay.mutate('credits')}
                >
                  Use credit ({formatMoney(balance, data.currencyCode)})
                </Button>
              )}
              {gateways.data?.data.map((g) => (
                <Button
                  key={g.id}
                  className="w-full"
                  loading={pay.isPending && pay.variables === g.id}
                  onClick={() => pay.mutate(g.id)}
                >
                  Pay with {g.label}
                </Button>
              ))}
              {gateways.data?.data.length === 0 && (isCredit || balance <= 0) && (
                <p className="text-[13px] text-muted">
                  No payment methods are available. Please contact support.
                </p>
              )}
              {pay.error && <p className="text-[13px] text-danger">{pay.error.message}</p>}
            </div>
          </>
        ) : (
          <Empty title={`This invoice is ${data.status}`} />
        )}
      </Card>
    </div>
  )
}

export function CreditsPage() {
  const user = useUser()
  const navigate = useNavigate()
  const [amount, setAmount] = useState('10')
  const topUp = useMutation({
    mutationFn: () =>
      api.post<{ data: { invoiceId: number } }>('/client/credits', { amount: Number(amount) }),
    onSuccess: ({ data }) => navigate({ to: '/invoices/$id', params: { id: String(data.invoiceId) } }),
  })
  const balances = Object.entries(user?.credits ?? {})
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Credit balance"
          subtitle="Credit is used automatically to pay renewals on their due date."
        />
        <div className="px-5 pb-5 text-3xl font-medium">
          {balances.length
            ? balances.map(([cur, v]) => <p key={cur}>{formatMoney(v, cur)}</p>)
            : formatMoney(0)}
        </div>
      </Card>
      <Card>
        <CardHeader title="Add credit" />
        <form
          className="space-y-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault()
            topUp.mutate()
          }}
        >
          <div className="flex flex-wrap gap-2">
            {['10', '25', '50', '100'].map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={amount === v ? 'primary' : 'outline'}
                onClick={() => setAmount(v)}
              >
                {formatMoney(v)}
              </Button>
            ))}
          </div>
          <Field label="Amount" error={topUp.error?.message}>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={topUp.isPending}>
            Continue to payment
          </Button>
        </form>
      </Card>
    </div>
  )
}
