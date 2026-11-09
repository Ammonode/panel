import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SchemaForm, type SettingField } from '../../components/forms'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api, formatDate, formatMoney } from '../../lib/api'
import { invoiceTone, statusLabel } from '../billing/invoices'
import { serviceTone } from '../billing/services'

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

type Coupon = {
  id: number
  code: string
  type: string
  value: string
  recurring: number | null
  maxUses: number | null
  uses: number
  expiresAt: string | null
}

export function AdminCouponsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'coupons'],
    queryFn: () => api.get<{ data: Coupon[] }>('/admin/coupons'),
  })
  const [form, setForm] = useState<null | {
    code: string
    type: string
    value: string
    recurring: string
    maxUses: string
    expiresAt: string
  }>(null)
  const save = useMutation({
    mutationFn: () =>
      api.post('/admin/coupons', {
        code: form!.code,
        type: form!.type,
        value: form!.value || '0',
        recurring: form!.recurring ? Number(form!.recurring) : null,
        maxUses: form!.maxUses ? Number(form!.maxUses) : null,
        expiresAt: form!.expiresAt || null,
      }),
    onSuccess: () => {
      setForm(null)
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  })
  const describe = (c: Coupon) =>
    c.type === 'percentage'
      ? `${Number(c.value)}% off`
      : c.type === 'fixed'
        ? `${formatMoney(c.value)} off`
        : 'No setup fee'
  return (
    <Card>
      <CardHeader
        title="Coupons"
        action={
          <Button
            onClick={() =>
              setForm({
                code: '',
                type: 'percentage',
                value: '10',
                recurring: '1',
                maxUses: '',
                expiresAt: '',
              })
            }
          >
            <Plus className="size-4" /> New coupon
          </Button>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <code className="flex-1 font-medium">{c.code}</code>
            <span>{describe(c)}</span>
            <span className="text-xs text-muted">
              {c.recurring === null
                ? 'every payment'
                : c.recurring === 1
                  ? 'first payment'
                  : `${c.recurring} payments`}
            </span>
            <Pill>
              {c.uses}
              {c.maxUses ? ` / ${c.maxUses}` : ''} uses
            </Pill>
            {c.expiresAt && <span className="text-xs text-muted">until {formatDate(c.expiresAt)}</span>}
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>
              Delete
            </Button>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No coupons yet" />}
      </div>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New coupon"
        footer={
          <>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Create
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Type">
              <select
                className={selectClass}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
                <option value="free_setup">Free setup</option>
              </select>
            </Field>
            {form.type !== 'free_setup' && (
              <Field label={form.type === 'percentage' ? 'Percent' : 'Amount'}>
                <Input
                  type="number"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </Field>
            )}
            <Field label="Applies to payments" hint="Empty = every payment">
              <Input
                type="number"
                min={1}
                value={form.recurring}
                onChange={(e) => setForm({ ...form, recurring: e.target.value })}
              />
            </Field>
            <Field label="Max uses">
              <Input
                type="number"
                min={1}
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              />
            </Field>
            <Field label="Expires">
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </Field>
            {save.error && <p className="col-span-2 text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

type Extension = {
  id: string
  name: string
  type: string
  version: string
  description?: string
  builtin: boolean
  enabled: boolean
  error: string | null
  settingsSchema: SettingField[]
  settings: Record<string, unknown>
}

function ExtensionCard({ ext }: { ext: Extension }) {
  const qc = useQueryClient()
  const [settings, setSettings] = useState(ext.settings)
  useEffect(() => setSettings(ext.settings), [ext.settings])
  const save = useMutation({
    mutationFn: (body: { enabled?: boolean; settings?: Record<string, unknown> }) =>
      api.put(`/admin/extensions/${ext.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'extensions'] }),
  })
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{ext.name}</h3>
            <Pill tone="info">{ext.type}</Pill>
            <span className="text-xs text-muted">
              v{ext.version}
              {ext.builtin ? ' · built-in' : ''}
            </span>
          </div>
          {ext.description && <p className="mt-1 text-[13px] text-muted">{ext.description}</p>}
          {ext.error && <p className="mt-1 text-[13px] text-danger">{ext.error}</p>}
        </div>
        <span className="flex items-center gap-2 text-[13px]">
          {ext.enabled ? 'Enabled' : 'Disabled'}
          <Toggle
            checked={ext.enabled}
            onChange={(v) => save.mutate({ enabled: v })}
            label={`Enable ${ext.name}`}
          />
        </span>
      </div>
      {ext.settingsSchema.length > 0 && (
        <form
          className="space-y-4 border-t border-line p-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ settings })
          }}
        >
          <SchemaForm fields={ext.settingsSchema} values={settings} onChange={setSettings} />
          {save.error && <p className="text-[13px] text-danger">{save.error.message}</p>}
          <Button type="submit" loading={save.isPending}>
            {save.isSuccess ? 'Saved' : 'Save settings'}
          </Button>
        </form>
      )}
    </Card>
  )
}

export function AdminExtensionsPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'extensions'],
    queryFn: () => api.get<{ data: Extension[] }>('/admin/extensions'),
  })
  return (
    <>
      <div>
        <h2 className="text-lg font-medium">Extensions</h2>
        <p className="text-[13px] text-muted">
          Payment gateways, provisioners, addons and themes. Install more by placing them in{' '}
          <code>storage/extensions</code>.
        </p>
      </div>
      {data?.data.map((e) => (
        <ExtensionCard key={e.id} ext={e} />
      ))}
    </>
  )
}

type AdminService = {
  id: number
  product: string
  status: string
  price: string
  currencyCode: string
  expiresAt: string | null
  user: { email: string }
  properties: { provisionError?: string }
}

export function AdminServicesPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const { data } = useQuery({
    queryKey: ['admin', 'services', status],
    queryFn: () => api.get<{ data: AdminService[] }>(`/admin/services${status ? `?status=${status}` : ''}`),
  })
  const action = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      api.post(`/admin/services/${id}/action`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'services'] }),
  })
  return (
    <Card>
      <CardHeader
        title="Services"
        action={
          <select
            className={`${selectClass} w-40`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status filter"
          >
            <option value="">All statuses</option>
            {['pending', 'active', 'suspended', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        }
      />
      {action.error && <p className="px-5 pb-3 text-[13px] text-danger">{action.error.message}</p>}
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <span className="w-10 text-xs text-muted">#{s.id}</span>
            <span className="min-w-40 flex-1">
              <span className="font-medium">{s.product}</span>
              <span className="block text-xs text-muted">{s.user.email}</span>
            </span>
            <span className="text-muted">
              {formatMoney(s.price, s.currencyCode)}
              {s.expiresAt && ` · ${formatDate(s.expiresAt)}`}
            </span>
            <Pill tone={serviceTone[s.status as keyof typeof serviceTone] ?? 'neutral'} dot>
              {statusLabel(s.status)}
            </Pill>
            {s.status === 'pending' && s.properties.provisionError && (
              <span className="flex w-full items-center justify-between gap-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
                Setup failed: {s.properties.provisionError}
                <Button
                  size="sm"
                  variant="outline"
                  loading={action.isPending}
                  onClick={() => action.mutate({ id: s.id, action: 'activate' })}
                >
                  Retry
                </Button>
              </span>
            )}
            <select
              className="h-8 rounded-lg border border-line bg-surface px-2 text-xs"
              value=""
              aria-label={`Actions for service ${s.id}`}
              onChange={(e) => e.target.value && action.mutate({ id: s.id, action: e.target.value })}
            >
              <option value="">Actions…</option>
              {s.status === 'pending' && <option value="activate">Activate</option>}
              {s.status === 'active' && <option value="suspend">Suspend</option>}
              {s.status === 'suspended' && <option value="unsuspend">Unsuspend</option>}
              {s.status !== 'cancelled' && <option value="terminate">Terminate</option>}
            </select>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No services" />}
      </div>
    </Card>
  )
}

type AdminInvoice = {
  id: number
  number: string
  status: string
  dueAt: string
  currencyCode: string
  total: string
  user: { email: string }
}

export function AdminInvoicesPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [paying, setPaying] = useState<AdminInvoice | null>(null)
  const [amount, setAmount] = useState('')
  const { data } = useQuery({
    queryKey: ['admin', 'invoices', status],
    queryFn: () => api.get<{ data: AdminInvoice[] }>(`/admin/invoices${status ? `?status=${status}` : ''}`),
  })
  const pay = useMutation({
    mutationFn: () => api.post(`/admin/invoices/${paying!.id}/payment`, { amount, gateway: 'manual' }),
    onSuccess: () => {
      setPaying(null)
      qc.invalidateQueries({ queryKey: ['admin', 'invoices'] })
    },
  })
  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/admin/invoices/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'invoices'] }),
  })
  return (
    <Card>
      <CardHeader
        title="Invoices"
        action={
          <select
            className={`${selectClass} w-40`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status filter"
          >
            <option value="">All statuses</option>
            {['pending', 'paid', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <span className="w-28 font-medium">{i.number}</span>
            <span className="min-w-40 flex-1 text-muted">{i.user.email}</span>
            <span className="text-muted">Due {formatDate(i.dueAt)}</span>
            <span className="w-24 text-right font-medium">{formatMoney(i.total, i.currencyCode)}</span>
            <Pill tone={invoiceTone[i.status as keyof typeof invoiceTone] ?? 'neutral'}>
              {statusLabel(i.status)}
            </Pill>
            {i.status === 'pending' && (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPaying(i)
                    setAmount(i.total)
                  }}
                >
                  Add payment
                </Button>
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(i.id)}>
                  Cancel
                </Button>
              </span>
            )}
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No invoices" />}
      </div>
      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={`Add payment to ${paying?.number}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button loading={pay.isPending} onClick={() => pay.mutate()}>
              Record payment
            </Button>
          </>
        }
      >
        <Field label="Amount">
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {pay.error && <p className="mt-2 text-danger">{pay.error.message}</p>}
      </Modal>
    </Card>
  )
}

const billingSettings: SettingField[] = [
  { key: 'app.name', label: 'Company name', type: 'text' },
  {
    key: 'billing.invoice_number_format',
    label: 'Invoice number format',
    type: 'text',
    description: 'Use {number} and {year}.',
  },
  {
    key: 'billing.invoice_days_before_due',
    label: 'Create renewal invoices (days before due)',
    type: 'number',
    min: 0,
  },
  { key: 'billing.suspend_after_days', label: 'Suspend after (days overdue)', type: 'number', min: 0 },
  { key: 'billing.terminate_after_days', label: 'Terminate after (days overdue)', type: 'number', min: 0 },
  {
    key: 'billing.cancel_pending_orders_after_days',
    label: 'Cancel unpaid orders after (days)',
    type: 'number',
    min: 1,
  },
  { key: 'billing.credits_enabled', label: 'Account credit', type: 'boolean' },
  { key: 'billing.credits_min_deposit', label: 'Minimum credit deposit', type: 'number', min: 0 },
  { key: 'billing.credits_max_deposit', label: 'Maximum credit deposit', type: 'number', min: 1 },
  { key: 'billing.tax_enabled', label: 'Taxes', type: 'boolean' },
  {
    key: 'billing.tax_type',
    label: 'Prices are',
    type: 'select',
    options: [
      { value: 'exclusive', label: 'Excluding tax' },
      { value: 'inclusive', label: 'Including tax' },
    ],
  },
  { key: 'auth.registration', label: 'Allow registration', type: 'boolean' },
]

export function AdminSettingsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<{ data: Record<string, unknown> }>('/admin/settings').then((r) => r.data),
  })
  const [values, setValues] = useState<Record<string, unknown>>({})
  useEffect(() => {
    if (data) setValues(Object.fromEntries(billingSettings.map((f) => [f.key, data[f.key]])))
  }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/admin/settings', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'settings'] }),
  })
  return (
    <Card>
      <CardHeader title="Settings" />
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <SchemaForm fields={billingSettings} values={values} onChange={setValues} />
        {save.error && <p className="text-[13px] text-danger">{save.error.message}</p>}
        <Button type="submit" loading={save.isPending}>
          {save.isSuccess ? 'Saved' : 'Save settings'}
        </Button>
      </form>
    </Card>
  )
}
