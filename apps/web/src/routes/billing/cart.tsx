import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Input } from '../../components/ui'
import { api, formatMoney } from '../../lib/api'
import { cart, toApiItems, useCart } from '../../lib/cart'
import { useCurrency } from '../../lib/currency'

type Priced = {
  currency: string
  coupon: { code: string } | null
  subtotal: string
  discount: string
  tax: string
  taxName: string | null
  taxRate: number
  total: string
  lines: {
    name: string
    plan: string
    configs: string[]
    price: string
    setupFee: string
    discount: string
    total: string
  }[]
}

export function CartPage() {
  const [currency] = useCurrency()
  const items = useCart()
  const navigate = useNavigate()
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<string | null>(null)
  const priced = useQuery({
    queryKey: ['cart', items, coupon, currency],
    enabled: items.length > 0,
    queryFn: () =>
      api.post<{ data: Priced }>('/store/cart', {
        items: toApiItems(items),
        couponCode: coupon,
        currency: currency || undefined,
      }),
    retry: false,
  })
  const order = useMutation({
    mutationFn: () =>
      api.post<{ data: { invoiceId: number; free: boolean } }>('/client/checkout', {
        items: toApiItems(items),
        couponCode: coupon,
        currency: currency || undefined,
      }),
    onSuccess: ({ data }) => {
      cart.clear()
      navigate(
        data.free ? { to: '/services' } : { to: '/invoices/$id', params: { id: String(data.invoiceId) } },
      )
    },
  })
  const p = priced.data?.data
  const couponError = priced.error && coupon ? priced.error.message : null

  if (!items.length) {
    return (
      <Card>
        <CardHeader title="Cart" />
        <Empty title="Your cart is empty">
          <Link to="/store" className="text-fg underline">
            Browse the store
          </Link>
        </Empty>
      </Card>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="self-start">
        <CardHeader title="Cart" />
        <div className="divide-y divide-line border-t border-line">
          {items.map((item, i) => {
            const line = p?.lines[i]
            return (
              <div key={item.key} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {line && <p className="text-xs text-muted">{line.plan}</p>}
                  {line?.configs.map((c) => (
                    <p key={c} className="text-xs text-muted">
                      {c}
                    </p>
                  ))}
                </div>
                <div className="text-right text-[13.5px]">
                  {line && <p className="font-medium">{formatMoney(line.total, p.currency)}</p>}
                  {line && Number(line.discount) > 0 && (
                    <p className="text-xs text-success">−{formatMoney(line.discount, p.currency)}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() => cart.remove(item.key)}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )
          })}
        </div>
      </Card>
      <Card className="self-start">
        <CardHeader title="Order summary" />
        <div className="space-y-4 px-5 pb-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setCoupon(couponInput.trim() || null)
            }}
          >
            <Input
              className="flex-1"
              placeholder="Coupon code"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              aria-label="Coupon code"
            />
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
          {couponError && (
            <p className="flex items-center justify-between text-[13px] text-danger">
              {couponError}
              <button
                type="button"
                className="text-xs text-muted underline"
                onClick={() => {
                  setCoupon(null)
                  setCouponInput('')
                }}
              >
                Remove
              </button>
            </p>
          )}
          {p && (
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{formatMoney(p.subtotal, p.currency)}</dd>
              </div>
              {Number(p.discount) > 0 && (
                <div className="flex justify-between text-success">
                  <dt>Discount ({p.coupon?.code})</dt>
                  <dd>−{formatMoney(p.discount, p.currency)}</dd>
                </div>
              )}
              {Number(p.tax) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {p.taxName} ({p.taxRate}%)
                  </dt>
                  <dd>{formatMoney(p.tax, p.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-3 text-base font-medium">
                <dt>Total due today</dt>
                <dd>{formatMoney(p.total, p.currency)}</dd>
              </div>
            </dl>
          )}
          {priced.error && !coupon && <p className="text-[13px] text-danger">{priced.error.message}</p>}
          {order.error && <p className="text-[13px] text-danger">{order.error.message}</p>}
          <Button className="w-full" loading={order.isPending} disabled={!p} onClick={() => order.mutate()}>
            Checkout
          </Button>
        </div>
      </Card>
    </div>
  )
}
