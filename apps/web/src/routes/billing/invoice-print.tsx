import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { api, formatDate, formatMoney } from '../../lib/api'

type Printable = {
  data: {
    id: number
    number: string | null
    status: string
    currencyCode: string
    createdAt: string
    dueAt: string
    paidAt: string | null
    items: { id: number; description: string; quantity: number; price: string; total: string }[]
    transactions: { id: number; gateway: string; amount: string; createdAt: string; status: string }[]
    total: string
    paid: string
    remaining: string
  }
  billing: {
    company: string
    companyName: string
    customer: { name: string; email: string; country: string | null } | null
  }
}

/** Print-friendly invoice. "Save as PDF" in the print dialog gives a PDF. */
function InvoicePrint({ path }: { path: string }) {
  const { data, error } = useQuery({
    queryKey: ['invoice-print', path],
    queryFn: () => api.get<Printable>(path),
  })
  useEffect(() => {
    document.title = data ? `Invoice ${data.data.number ?? data.data.id}` : 'Invoice'
  }, [data])
  if (error) return <p className="p-10 text-center text-sm">This invoice could not be loaded.</p>
  if (!data) return null
  const inv = data.data
  const money = (v: string) => formatMoney(v, inv.currencyCode)
  return (
    <div className="min-h-dvh bg-canvas py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] justify-end gap-2 px-4 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="h-10 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          Print / save as PDF
        </button>
      </div>
      <article className="mx-auto max-w-[800px] rounded-card border border-line bg-white p-10 text-[13px] text-[#1b1d27] print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-6 border-b border-[#e6e7eb] pb-6">
          <div>
            <p className="text-lg font-semibold">{data.billing.companyName}</p>
            <p className="mt-1 whitespace-pre-line text-[#6b6f7b]">{data.billing.company}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">Invoice</p>
            <p className="font-medium">{inv.number ?? `#${inv.id}`}</p>
            <p
              className={`mt-2 inline-block rounded-md px-2 py-0.5 text-xs font-medium uppercase ${inv.status === 'paid' ? 'bg-[#dff6e8] text-[#1f8f52]' : inv.status === 'pending' ? 'bg-[#fff1d6] text-[#b26b00]' : 'bg-[#ececef] text-[#6b6f7b]'}`}
            >
              {inv.status}
            </p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 py-6">
          <div>
            <p className="text-xs uppercase text-[#9a9eab]">Billed to</p>
            <p className="mt-1 font-medium">{data.billing.customer?.name}</p>
            <p className="text-[#6b6f7b]">{data.billing.customer?.email}</p>
            {data.billing.customer?.country && (
              <p className="text-[#6b6f7b]">{data.billing.customer.country}</p>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-right">
            <dt className="text-[#9a9eab]">Issued</dt>
            <dd>{formatDate(inv.createdAt)}</dd>
            <dt className="text-[#9a9eab]">Due</dt>
            <dd>{formatDate(inv.dueAt)}</dd>
            {inv.paidAt && (
              <>
                <dt className="text-[#9a9eab]">Paid</dt>
                <dd>{formatDate(inv.paidAt)}</dd>
              </>
            )}
          </dl>
        </section>
        <table className="w-full">
          <thead>
            <tr className="border-y border-[#e6e7eb] text-left text-xs uppercase text-[#9a9eab] [&>th]:py-2">
              <th>Description</th>
              <th className="w-16 text-right">Qty</th>
              <th className="w-28 text-right">Price</th>
              <th className="w-28 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id} className="border-b border-[#f0f1f3] align-top [&>td]:py-2.5">
                <td className="whitespace-pre-line pr-4">{i.description}</td>
                <td className="text-right">{i.quantity}</td>
                <td className="text-right">{money(i.price)}</td>
                <td className="text-right">{money(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-64 space-y-1">
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd>{money(inv.total)}</dd>
          </div>
          {Number(inv.paid) > 0 && (
            <div className="flex justify-between text-[#6b6f7b]">
              <dt>Paid</dt>
              <dd>−{money(inv.paid)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-[#e6e7eb] pt-2 text-base font-semibold">
            <dt>Amount due</dt>
            <dd>{money(inv.remaining)}</dd>
          </div>
        </dl>
        {inv.transactions.length > 0 && (
          <section className="mt-8">
            <p className="mb-2 text-xs uppercase text-[#9a9eab]">Transactions</p>
            {inv.transactions.map((t) => (
              <p key={t.id} className="flex justify-between border-b border-[#f0f1f3] py-1.5 text-xs">
                <span>
                  {formatDate(t.createdAt, true)} · {t.gateway}
                  {t.status === 'refunded' ? ' (refund)' : ''}
                </span>
                <span>{money(t.amount)}</span>
              </p>
            ))}
          </section>
        )}
      </article>
    </div>
  )
}

export function InvoicePrintPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  return <InvoicePrint path={`/client/invoices/${id}`} />
}
export function AdminInvoicePrintPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  return <InvoicePrint path={`/admin/invoices/${id}`} />
}
