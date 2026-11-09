import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Package, ShoppingCart } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, CardHeader, cn, Empty, Field, IconTile, Input, Pill } from '../../components/ui'
import { api, formatMoney } from '../../lib/api'
import { cart, useCart } from '../../lib/cart'

export type Plan = {
  id: number
  name: string
  type: string
  label: string
  price: string
  setupFee: string
  billingPeriod: number
  billingUnit: string
}
type Category = { id: number; slug: string; name: string; description: string | null; image: string | null }
type Product = {
  id: number
  slug: string
  name: string
  description: string | null
  image: string | null
  plans: Plan[]
  inStock: boolean
}
type Option = {
  id: number
  name: string
  type: 'select' | 'radio' | 'slider' | 'number' | 'text' | 'checkbox'
  plans: Plan[]
  values: { id: number; name: string; plans: Plan[] }[]
}
type CheckoutField = { key: string; label: string; type: string; description?: string; required?: boolean }

export function StorePage() {
  const { data } = useQuery({
    queryKey: ['store', 'categories'],
    queryFn: () => api.get<{ data: Category[] }>('/store/categories'),
  })
  return (
    <Card>
      <CardHeader title="Store" subtitle="Pick a category to see our plans." action={<CartButton />} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        {data?.data.map((c) => (
          <Link
            key={c.id}
            to="/store/$category"
            params={{ category: c.slug }}
            className="flex gap-4 rounded-[12px] border border-line bg-surface-2 p-4 hover:border-subtle"
          >
            <IconTile>
              <Package className="size-5" />
            </IconTile>
            <div className="min-w-0">
              <p className="font-medium">{c.name}</p>
              {c.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{c.description}</p>}
            </div>
          </Link>
        ))}
      </div>
      {data?.data.length === 0 && (
        <Empty title="The store is empty">Products added in the admin area show up here.</Empty>
      )}
    </Card>
  )
}

export function CartButton() {
  const items = useCart()
  return (
    <Link
      to="/cart"
      className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
    >
      <ShoppingCart className="size-4" /> Cart{' '}
      {items.length > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-fg">{items.length}</span>
      )}
    </Link>
  )
}

const cheapest = (plans: Plan[]) => [...plans].sort((a, b) => Number(a.price) - Number(b.price))[0]

export function CategoryPage() {
  const { category } = useParams({ strict: false }) as { category: string }
  const { data, error } = useQuery({
    queryKey: ['store', 'category', category],
    queryFn: () =>
      api.get<{ category: Category; currency: { code: string }; data: Product[] }>(
        `/store/categories/${category}`,
      ),
  })
  if (error)
    return (
      <Card>
        <Empty title="Category not found" />
      </Card>
    )
  return (
    <Card>
      <CardHeader
        title={data?.category.name ?? ''}
        subtitle={data?.category.description}
        action={<CartButton />}
      />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
        {data?.data.map((p) => {
          const from = cheapest(p.plans)
          return (
            <div key={p.id} className="flex flex-col rounded-[12px] border border-line bg-surface-2 p-5">
              <p className="text-[15px] font-medium">{p.name}</p>
              {p.description && (
                <p className="mt-1 flex-1 text-[13px] whitespace-pre-line text-muted">{p.description}</p>
              )}
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  {from && (
                    <>
                      <span className="text-xs text-muted">From</span>
                      <p className="text-xl font-medium">
                        {formatMoney(from.price, data.currency.code)}
                        <span className="text-xs font-normal text-muted"> / {from.label.toLowerCase()}</span>
                      </p>
                    </>
                  )}
                </div>
                {p.inStock ? (
                  <Link
                    to="/store/product/$slug"
                    params={{ slug: p.slug }}
                    className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90"
                  >
                    Order
                  </Link>
                ) : (
                  <Pill tone="danger">Out of stock</Pill>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {data?.data.length === 0 && <Empty title="No products in this category yet" />}
    </Card>
  )
}

export function ProductPage() {
  const { slug } = useParams({ strict: false }) as { slug: string }
  const navigate = useNavigate()
  const { data, error } = useQuery({
    queryKey: ['store', 'product', slug],
    queryFn: () =>
      api.get<{
        currency: { code: string }
        data: Product & { configOptions: Option[]; checkoutFields: CheckoutField[]; allowQuantity: string }
      }>(`/store/products/${slug}`),
  })
  const product = data?.data
  const [planId, setPlanId] = useState<number | null>(null)
  const [options, setOptions] = useState<Record<string, string | boolean>>({})
  const [fields, setFields] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!product) return
    setPlanId((p) => p ?? product.plans[0]?.id ?? null)
    setOptions((o) => {
      const next = { ...o }
      for (const opt of product.configOptions) {
        if (next[opt.id] !== undefined) continue
        if (opt.type === 'select' || opt.type === 'radio') next[opt.id] = String(opt.values[0]?.id ?? '')
        else if (opt.type === 'checkbox') next[opt.id] = false
        else next[opt.id] = ''
      }
      return next
    })
  }, [product])

  const item = useMemo(
    () =>
      product && planId
        ? { productId: product.id, planId, quantity: 1, configOptions: options, checkoutConfig: fields }
        : null,
    [product, planId, options, fields],
  )
  const preview = useQuery({
    queryKey: ['store', 'preview', item],
    enabled: !!item,
    queryFn: () =>
      api.post<{ data: { total: string; subtotal: string; lines: { price: string; setupFee: string }[] } }>(
        '/store/cart',
        { items: [item] },
      ),
    placeholderData: (prev) => prev,
  })
  const add = useMutation({
    mutationFn: async () => {
      cart.add({ ...item!, name: product!.name })
      navigate({ to: '/cart' })
    },
  })

  if (error)
    return (
      <Card>
        <Empty title="Product not found" />
      </Card>
    )
  if (!product || !data) return null
  const plan = product.plans.find((p) => p.id === planId)
  const currency = data.currency.code
  const optionPrice = (plans: Plan[]) => {
    const match = plans.find(
      (p) =>
        plan &&
        p.billingPeriod === plan.billingPeriod &&
        p.billingUnit === plan.billingUnit &&
        p.type === plan.type,
    )
    return match && Number(match.price) > 0 ? ` (+${formatMoney(match.price, currency)})` : ''
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title={product.name} subtitle={product.description} />
        <div className="space-y-6 px-5 pb-5">
          <section>
            <h3 className="mb-2 text-[13px] font-medium">Billing cycle</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {product.plans.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setPlanId(p.id)}
                  className={cn(
                    'flex items-center justify-between rounded-[12px] border p-4 text-left',
                    p.id === planId
                      ? 'border-primary bg-surface'
                      : 'border-line bg-surface-2 hover:border-subtle',
                  )}
                >
                  <span>
                    <span className="block text-[13.5px] font-medium">{p.label}</span>
                    <span className="text-xs text-muted">
                      {formatMoney(p.price, currency)}
                      {Number(p.setupFee) > 0 && ` + ${formatMoney(p.setupFee, currency)} setup`}
                    </span>
                  </span>
                  {p.id === planId && <Check className="size-4" />}
                </button>
              ))}
            </div>
          </section>

          {product.configOptions.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[13px] font-medium">Configuration</h3>
              {product.configOptions.map((o) => (
                <Field key={o.id} label={o.name}>
                  {o.type === 'select' && (
                    <select
                      className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm"
                      value={String(options[o.id] ?? '')}
                      onChange={(e) => setOptions({ ...options, [o.id]: e.target.value })}
                    >
                      {o.values.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {optionPrice(v.plans)}
                        </option>
                      ))}
                    </select>
                  )}
                  {o.type === 'radio' && (
                    <div className="flex flex-wrap gap-2">
                      {o.values.map((v) => (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => setOptions({ ...options, [o.id]: String(v.id) })}
                          className={cn(
                            'rounded-[10px] border px-3 py-2 text-[13px]',
                            String(options[o.id]) === String(v.id)
                              ? 'border-primary bg-surface font-medium'
                              : 'border-line bg-surface-2',
                          )}
                        >
                          {v.name}
                          {optionPrice(v.plans)}
                        </button>
                      ))}
                    </div>
                  )}
                  {o.type === 'checkbox' && (
                    <span className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={!!options[o.id]}
                        onChange={(e) => setOptions({ ...options, [o.id]: e.target.checked })}
                      />{' '}
                      Enable{optionPrice(o.plans)}
                    </span>
                  )}
                  {(o.type === 'text' || o.type === 'number' || o.type === 'slider') && (
                    <Input
                      type={o.type === 'text' ? 'text' : 'number'}
                      value={String(options[o.id] ?? '')}
                      onChange={(e) => setOptions({ ...options, [o.id]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </section>
          )}

          {product.checkoutFields.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-[13px] font-medium">Details</h3>
              {product.checkoutFields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.description}>
                  <Input
                    value={fields[f.key] ?? ''}
                    onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                  />
                </Field>
              ))}
            </section>
          )}
        </div>
      </Card>

      <Card className="self-start">
        <CardHeader title="Summary" />
        <dl className="space-y-2 px-5 pb-4 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-muted">{plan?.label}</dt>
            <dd>{preview.data && formatMoney(preview.data.data.lines[0]?.price ?? 0, currency)}</dd>
          </div>
          {preview.data && Number(preview.data.data.lines[0]?.setupFee) > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Setup fee</dt>
              <dd>{formatMoney(preview.data.data.lines[0]!.setupFee, currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-3 text-base font-medium">
            <dt>Due today</dt>
            <dd>{preview.data ? formatMoney(preview.data.data.total, currency) : '—'}</dd>
          </div>
        </dl>
        {preview.error && <p className="px-5 pb-3 text-[13px] text-danger">{preview.error.message}</p>}
        <div className="px-5 pb-5">
          <Button
            className="w-full"
            disabled={!item || !!preview.error || !product.inStock}
            onClick={() => add.mutate()}
          >
            <ShoppingCart className="size-4" /> Add to cart
          </Button>
        </div>
      </Card>
    </div>
  )
}
