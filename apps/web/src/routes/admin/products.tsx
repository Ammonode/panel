import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  cleanPlans,
  emptyPlan,
  type PlanForm,
  PlansEditor,
  SchemaForm,
  type SettingField,
  toPlanForms,
} from '../../components/forms'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api, formatMoney } from '../../lib/api'

type Category = {
  id: number
  name: string
  slug: string
  description: string | null
  hidden: boolean
  productCount: number
}
type ApiPlan = {
  id: number
  name: string
  type: string
  billingPeriod: number
  billingUnit: string
  prices: { currency: string; price: string; setupFee: string }[]
}
type Product = {
  id: number
  categoryId: number
  name: string
  slug: string
  description: string | null
  stock: number | null
  perUserLimit: number | null
  hidden: boolean
  serverExtension: string | null
  serverSettings: Record<string, unknown>
  plans: ApiPlan[]
  upgradeIds?: number[]
}
type Provisioner = { id: string; name: string; fields: SettingField[] }

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

export const useCurrencies = () =>
  useQuery({
    queryKey: ['admin', 'currencies'],
    queryFn: () =>
      api.get<{ data: { code: string; isDefault: boolean }[] }>('/admin/currencies').then((r) => r.data),
  })

export function AdminProductsPage() {
  const qc = useQueryClient()
  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.get<{ data: Category[] }>('/admin/categories'),
  })
  const products = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<{ data: Product[] }>('/admin/products'),
  })
  const [newCategory, setNewCategory] = useState<{ name: string; description: string } | null>(null)
  const createCategory = useMutation({
    mutationFn: () =>
      api.post('/admin/categories', {
        name: newCategory!.name,
        slug: slugify(newCategory!.name),
        description: newCategory!.description,
      }),
    onSuccess: () => {
      setNewCategory(null)
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] })
    },
  })
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Products</h2>
        <div className="flex gap-2">
          <Link
            to="/admin/config-options"
            className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-3 text-sm hover:bg-surface-2"
          >
            Config options
          </Link>
          <Button variant="outline" onClick={() => setNewCategory({ name: '', description: '' })}>
            <Plus className="size-4" /> Category
          </Button>
          <Link
            to="/admin/products/$id"
            params={{ id: 'new' }}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            <Plus className="size-4" /> Product
          </Link>
        </div>
      </div>
      {categories.data?.data.length === 0 && (
        <Card>
          <Empty title="Create a category first">Products are grouped in categories in the store.</Empty>
        </Card>
      )}
      {categories.data?.data.map((c) => (
        <Card key={c.id}>
          <CardHeader
            title={c.name}
            subtitle={`/store/${c.slug}`}
            action={c.hidden ? <Pill>Hidden</Pill> : undefined}
          />
          <div className="divide-y divide-line border-t border-line">
            {products.data?.data
              .filter((p) => p.categoryId === c.id)
              .map((p) => (
                <Link
                  key={p.id}
                  to="/admin/products/$id"
                  params={{ id: String(p.id) }}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-surface-2"
                >
                  <span className="flex-1 font-medium">{p.name}</span>
                  {p.serverExtension && <Pill tone="info">{p.serverExtension}</Pill>}
                  {p.hidden && <Pill>Hidden</Pill>}
                  {p.stock !== null && <Pill tone={p.stock > 0 ? 'neutral' : 'danger'}>Stock {p.stock}</Pill>}
                  <span className="text-muted">
                    {p.plans
                      .map((pl) =>
                        pl.type === 'free'
                          ? 'Free'
                          : `${formatMoney(pl.prices[0]?.price ?? 0, pl.prices[0]?.currency ?? 'USD')}/${pl.billingPeriod > 1 ? pl.billingPeriod : ''}${pl.billingUnit[0]}`,
                      )
                      .join(' · ')}
                  </span>
                </Link>
              ))}
            {products.data && !products.data.data.some((p) => p.categoryId === c.id) && (
              <Empty title="No products in this category" />
            )}
          </div>
        </Card>
      ))}
      <Modal
        open={!!newCategory}
        onClose={() => setNewCategory(null)}
        title="New category"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewCategory(null)}>
              Cancel
            </Button>
            <Button loading={createCategory.isPending} onClick={() => createCategory.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input
              autoFocus
              value={newCategory?.name ?? ''}
              onChange={(e) => setNewCategory({ ...newCategory!, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <Input
              value={newCategory?.description ?? ''}
              onChange={(e) => setNewCategory({ ...newCategory!, description: e.target.value })}
            />
          </Field>
          {createCategory.error && <p className="text-danger">{createCategory.error.message}</p>}
        </div>
      </Modal>
    </>
  )
}

export function AdminProductEditPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const isNew = id === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const currencies = useCurrencies()
  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.get<{ data: Category[] }>('/admin/categories'),
  })
  const provisioners = useQuery({
    queryKey: ['admin', 'provisioners'],
    queryFn: () => api.get<{ data: Provisioner[] }>('/admin/provisioners'),
  })
  const existing = useQuery({
    queryKey: ['admin', 'product', id],
    enabled: !isNew,
    queryFn: () => api.get<{ data: Product }>(`/admin/products/${id}`).then((r) => r.data),
  })

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    categoryId: 0,
    stock: '',
    perUserLimit: '',
    hidden: false,
    serverExtension: '',
    serverSettings: {} as Record<string, unknown>,
  })
  const [plans, setPlans] = useState<PlanForm[]>([])
  const [upgradeIds, setUpgradeIds] = useState<number[]>([])
  const allProducts = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<{ data: Product[] }>('/admin/products'),
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const defaultCurrency = currencies.data?.find((c) => c.isDefault)?.code ?? 'USD'

  useEffect(() => {
    if (isNew) {
      setPlans((p) => (p.length ? p : [emptyPlan(defaultCurrency)]))
      setForm((f) => ({ ...f, categoryId: f.categoryId || (categories.data?.data[0]?.id ?? 0) }))
      return
    }
    const p = existing.data
    if (!p) return
    setForm({
      name: p.name,
      slug: p.slug,
      description: p.description ?? '',
      categoryId: p.categoryId,
      stock: p.stock?.toString() ?? '',
      perUserLimit: p.perUserLimit?.toString() ?? '',
      hidden: p.hidden,
      serverExtension: p.serverExtension ?? '',
      serverSettings: p.serverSettings,
    })
    setPlans(toPlanForms(p.plans))
    setUpgradeIds(p.upgradeIds ?? [])
    setSlugTouched(true)
  }, [existing.data, isNew, categories.data, defaultCurrency])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        description: form.description || null,
        stock: form.stock === '' ? null : Number(form.stock),
        perUserLimit: form.perUserLimit === '' ? null : Number(form.perUserLimit),
        serverExtension: form.serverExtension || null,
        plans: cleanPlans(plans),
        upgradeIds,
      }
      return isNew ? api.post('/admin/products', body) : api.put(`/admin/products/${id}`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      navigate({ to: '/admin/products' })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      navigate({ to: '/admin/products' })
    },
  })
  const provisioner = provisioners.data?.data.find((p) => p.id === form.serverExtension)
  const err = save.error as (Error & { details?: Record<string, string> }) | null

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Card>
        <CardHeader title={isNew ? 'New product' : `Edit ${existing.data?.name ?? ''}`} />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Name" error={err?.details?.name}>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: slugTouched ? form.slug : slugify(e.target.value),
                })
              }
            />
          </Field>
          <Field label="URL slug" error={err?.details?.slug}>
            <Input
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                setForm({ ...form, slug: e.target.value })
              }}
            />
          </Field>
          <Field label="Category">
            <select
              className={selectClass}
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
            >
              {categories.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock" hint="Empty = unlimited">
              <Input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </Field>
            <Field label="Per customer limit">
              <Input
                type="number"
                min={1}
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea
                className="min-h-24 w-full rounded-[10px] border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
          </div>
          <span className="flex items-center gap-3 text-[13px]">
            <Toggle checked={form.hidden} onChange={(v) => setForm({ ...form, hidden: v })} label="Hidden" />{' '}
            Hidden from the store
          </span>
        </div>
      </Card>
      <Card>
        <CardHeader title="Pricing" subtitle="Each plan is a billing cycle customers can choose." />
        <div className="px-5 pb-5">
          <PlansEditor
            plans={plans}
            onChange={setPlans}
            currencies={currencies.data?.map((c) => c.code) ?? ['USD']}
          />
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Upgrade paths"
          subtitle="Products customers can switch this service to. They pay the prorated difference; downgrades apply right away."
        />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {allProducts.data?.data
            .filter((p) => String(p.id) !== id)
            .map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={upgradeIds.includes(p.id)}
                  onChange={(e) =>
                    setUpgradeIds(
                      e.target.checked ? [...upgradeIds, p.id] : upgradeIds.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          {allProducts.data?.data.length === 1 && (
            <p className="text-[13px] text-muted">Create another product to offer upgrades.</p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Provisioning" subtitle="What happens when this product is paid for." />
        <div className="space-y-4 px-5 pb-5">
          <Field label="Server extension">
            <select
              className={selectClass}
              value={form.serverExtension}
              onChange={(e) => setForm({ ...form, serverExtension: e.target.value })}
            >
              <option value="">None (manual)</option>
              {provisioners.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {provisioner && (
            <SchemaForm
              fields={provisioner.fields}
              values={form.serverSettings}
              onChange={(v) => setForm({ ...form, serverSettings: v })}
            />
          )}
        </div>
      </Card>
      {save.error && <p className="text-[13px] text-danger">{save.error.message}</p>}
      <div className="flex justify-between">
        {!isNew ? (
          <Button type="button" variant="outline" loading={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={save.isPending}>
          {isNew ? 'Create product' : 'Save changes'}
        </Button>
      </div>
      {remove.error && <p className="text-right text-[13px] text-danger">{remove.error.message}</p>}
    </form>
  )
}

type ConfigOption = {
  id: number
  name: string
  envVariable: string | null
  type: string
  productIds: number[]
  plans: ApiPlan[]
  values: { id: number; name: string; envVariable: string | null; plans: ApiPlan[] }[]
}
type OptionForm = {
  id?: number
  name: string
  envVariable: string
  type: string
  productIds: number[]
  plans: PlanForm[]
  values: { id?: number; name: string; envVariable: string; plans: PlanForm[] }[]
}

export function AdminConfigOptionsPage() {
  const qc = useQueryClient()
  const currencies = useCurrencies()
  const options = useQuery({
    queryKey: ['admin', 'config-options'],
    queryFn: () => api.get<{ data: ConfigOption[] }>('/admin/config-options'),
  })
  const products = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<{ data: Product[] }>('/admin/products'),
  })
  const [edit, setEdit] = useState<OptionForm | null>(null)
  const curs = currencies.data?.map((c) => c.code) ?? ['USD']
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...edit!,
        envVariable: edit!.envVariable || null,
        plans: cleanPlans(edit!.plans),
        values: edit!.values.map((v) => ({
          ...v,
          envVariable: v.envVariable || null,
          plans: cleanPlans(v.plans),
        })),
      }
      return edit!.id
        ? api.put(`/admin/config-options/${edit!.id}`, body)
        : api.post('/admin/config-options', body)
    },
    onSuccess: () => {
      setEdit(null)
      qc.invalidateQueries({ queryKey: ['admin', 'config-options'] })
    },
  })
  const open = (o?: ConfigOption) =>
    setEdit(
      o
        ? {
            id: o.id,
            name: o.name,
            envVariable: o.envVariable ?? '',
            type: o.type,
            productIds: o.productIds,
            plans: toPlanForms(o.plans),
            values: o.values.map((v) => ({
              id: v.id,
              name: v.name,
              envVariable: v.envVariable ?? '',
              plans: toPlanForms(v.plans),
            })),
          }
        : {
            name: '',
            envVariable: '',
            type: 'select',
            productIds: [],
            plans: [],
            values: [{ name: '', envVariable: '', plans: [] }],
          },
    )

  if (edit) {
    const choice = edit.type === 'select' || edit.type === 'radio'
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Card>
          <CardHeader title={edit.id ? 'Edit config option' : 'New config option'} />
          <div className="grid gap-4 px-5 pb-5 md:grid-cols-3">
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Environment variable" hint="e.g. memory, disk, location or an egg variable">
              <Input
                value={edit.envVariable}
                onChange={(e) => setEdit({ ...edit, envVariable: e.target.value })}
              />
            </Field>
            <Field label="Type">
              <select
                className={selectClass}
                value={edit.type}
                onChange={(e) => setEdit({ ...edit, type: e.target.value })}
              >
                {['select', 'radio', 'checkbox', 'text', 'number', 'slider'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-3">
              <Field label="Products">
                <div className="flex flex-wrap gap-2">
                  {products.data?.data.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]"
                    >
                      <input
                        type="checkbox"
                        checked={edit.productIds.includes(p.id)}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            productIds: e.target.checked
                              ? [...edit.productIds, p.id]
                              : edit.productIds.filter((x) => x !== p.id),
                          })
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        </Card>
        {edit.type === 'checkbox' && (
          <Card>
            <CardHeader title="Price when enabled" />
            <div className="px-5 pb-5">
              <PlansEditor
                compact
                plans={edit.plans}
                onChange={(plans) => setEdit({ ...edit, plans })}
                currencies={curs}
              />
            </div>
          </Card>
        )}
        {choice && (
          <Card>
            <CardHeader
              title="Values"
              subtitle="Add a plan matching each product billing cycle to charge extra for a value."
            />
            <div className="space-y-3 px-5 pb-5">
              {edit.values.map((v, i) => (
                <div key={v.id ?? `new-${i}`} className="space-y-3 rounded-[12px] border border-line p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Label">
                      <Input
                        value={v.name}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            values: edit.values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          })
                        }
                      />
                    </Field>
                    <Field label="Value sent to the server">
                      <Input
                        value={v.envVariable}
                        placeholder="e.g. 2048"
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            values: edit.values.map((x, j) =>
                              j === i ? { ...x, envVariable: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEdit({ ...edit, values: edit.values.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </Button>
                  </div>
                  <PlansEditor
                    compact
                    plans={v.plans}
                    onChange={(plans) =>
                      setEdit({ ...edit, values: edit.values.map((x, j) => (j === i ? { ...x, plans } : x)) })
                    }
                    currencies={curs}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setEdit({ ...edit, values: [...edit.values, { name: '', envVariable: '', plans: [] }] })
                }
              >
                <Plus className="size-3.5" /> Add value
              </Button>
            </div>
          </Card>
        )}
        {save.error && <p className="text-[13px] text-danger">{save.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setEdit(null)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    )
  }
  return (
    <Card>
      <CardHeader
        title="Config options"
        subtitle="Choices customers make when ordering, such as memory or game version."
        action={
          <Button onClick={() => open()}>
            <Plus className="size-4" /> New option
          </Button>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {options.data?.data.map((o) => (
          <button
            type="button"
            key={o.id}
            onClick={() => open(o)}
            className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left text-[13.5px] hover:bg-surface-2"
          >
            <span className="flex-1 font-medium">{o.name}</span>
            {o.envVariable && <code className="text-xs text-muted">{o.envVariable}</code>}
            <Pill>{o.type}</Pill>
            <span className="text-xs text-muted">
              {o.values.length ? `${o.values.length} values · ` : ''}
              {o.productIds.length} products
            </span>
          </button>
        ))}
        {options.data?.data.length === 0 && <Empty title="No config options yet" />}
      </div>
    </Card>
  )
}
