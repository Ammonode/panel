import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { ApiError, api, formatDate } from '../../lib/api'
import { usePublicSettings } from '../../lib/settings'

/** Logo upload used on the admin settings page. */
export function BrandingCard() {
  const qc = useQueryClient()
  const settings = usePublicSettings()
  const input = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('logo', file)
      const res = await fetch('/api/admin/branding/logo', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? 'Upload failed', 'error')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/admin/branding/logo'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
  const logo = settings.data?.['app.logo']
  return (
    <Card>
      <CardHeader
        title="Branding"
        subtitle="Shown in the sidebar, sign in pages and emails. PNG, JPG, WebP or SVG up to 1 MB."
      />
      <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
        <div className="grid h-16 w-48 place-items-center rounded-[12px] border border-dashed border-line bg-surface-2">
          {logo ? (
            <img src={logo} alt="Logo" className="max-h-12 max-w-40 object-contain" />
          ) : (
            <span className="text-xs text-muted">No logo</span>
          )}
        </div>
        <Button variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}>
          Upload logo
        </Button>
        {logo && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
        {upload.error && <span className="text-[13px] text-danger">{upload.error.message}</span>}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
      </div>
    </Card>
  )
}

type Announcement = {
  id: number
  title: string
  slug: string
  description: string | null
  content: string
  isActive: boolean
  publishedAt: string | null
  createdAt: string
}
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

export function AdminAnnouncementsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api.get<{ data: Announcement[] }>('/admin/announcements'),
  })
  const [edit, setEdit] = useState<null | {
    id?: number
    title: string
    description: string
    content: string
    isActive: boolean
  }>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    qc.invalidateQueries({ queryKey: ['announcements'] })
  }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: edit!.title,
        slug: slugify(edit!.title) || `post-${Date.now()}`,
        description: edit!.description || null,
        content: edit!.content,
        isActive: edit!.isActive,
      }
      return edit!.id
        ? api.patch(`/admin/announcements/${edit!.id}`, body)
        : api.post('/admin/announcements', body)
    },
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/announcements/${id}`),
    onSuccess: refresh,
  })
  return (
    <Card>
      <CardHeader
        title="Announcements"
        subtitle="The newest one is shown on every customer dashboard."
        action={
          <Button onClick={() => setEdit({ title: '', description: '', content: '', isActive: true })}>
            <Plus className="size-4" /> New announcement
          </Button>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <span className="min-w-48 flex-1">
              <span className="font-medium">{a.title}</span>
              <span className="block text-xs text-muted">{a.description}</span>
            </span>
            {!a.isActive && <Pill>Hidden</Pill>}
            <span className="text-xs text-muted">{a.publishedAt && formatDate(a.publishedAt)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEdit({
                  id: a.id,
                  title: a.title,
                  description: a.description ?? '',
                  content: a.content,
                  isActive: a.isActive,
                })
              }
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>
              Delete
            </Button>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No announcements yet" />}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit announcement' : 'New announcement'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Publish
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3 text-fg">
            <Field label="Title">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Summary" hint="Shown on the dashboard">
              <Input
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </Field>
            <Field label="Content">
              <textarea
                className="h-48 w-full rounded-[10px] border border-line bg-surface p-3 text-sm"
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </Field>
            <span className="flex items-center gap-3 text-[13px]">
              <Toggle
                checked={edit.isActive}
                onChange={(v) => setEdit({ ...edit, isActive: v })}
                label="Visible"
              />{' '}
              Visible to customers
            </span>
            {save.error && <p className="text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

const BACKUP_MASK = '••••••••'
/** Where backups are stored: on the nodes or in an S3 compatible bucket. */
export function BackupStorageCard() {
  const { data } = useQuery({
    queryKey: ['admin', 'backup-storage'],
    queryFn: () =>
      api.get<{ data: Record<string, string | boolean> }>('/admin/backup-storage').then((r) => r.data),
  })
  const [form, setForm] = useState<Record<string, string | boolean> | null>(null)
  const v = form ?? data ?? {}
  const set = (k: string, val: string | boolean) => setForm({ ...v, [k]: val })
  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/backup-storage', { ...v, 'backups.s3_path_style': !!v['backups.s3_path_style'] }),
  })
  const test = useMutation({
    mutationFn: async () => {
      await save.mutateAsync()
      return api.post('/admin/backup-storage/test')
    },
  })
  const s3 = v['backups.driver'] === 's3'
  const text = (k: string, label: string, hint?: string, type = 'text') => (
    <Field label={label} hint={hint}>
      <Input
        type={type}
        value={String(v[k] ?? '')}
        autoComplete="off"
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  )
  return (
    <Card>
      <CardHeader
        title="Backup storage"
        subtitle="S3 keeps backups off the nodes. Nodes never receive your S3 keys, only short lived upload links."
      />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
        <Field label="Store backups">
          <select
            className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm"
            value={String(v['backups.driver'] ?? 'local')}
            onChange={(e) => set('backups.driver', e.target.value)}
          >
            <option value="local">On the node</option>
            <option value="s3">S3 compatible storage</option>
          </select>
        </Field>
        <span />
        {s3 && (
          <>
            {text(
              'backups.s3_endpoint',
              'Endpoint',
              'Empty for AWS. e.g. https://s3.eu-central-003.backblazeb2.com',
            )}
            {text('backups.s3_region', 'Region')}
            {text('backups.s3_bucket', 'Bucket')}
            {text('backups.s3_prefix', 'Folder prefix')}
            {text('backups.s3_access_key', 'Access key')}
            {text(
              'backups.s3_secret_key',
              'Secret key',
              v['backups.s3_secret_key'] === BACKUP_MASK ? 'Saved, leave as is to keep it' : undefined,
              'password',
            )}
            <span className="flex items-center gap-3 text-[13px]">
              <Toggle
                checked={!!v['backups.s3_path_style']}
                onChange={(x) => set('backups.s3_path_style', x)}
                label="Path style"
              />{' '}
              Path-style URLs (MinIO and most self-hosted stores)
            </span>
          </>
        )}
        <div className="flex items-center justify-end gap-3 md:col-span-2">
          {(save.error || test.error) && (
            <span className="text-[13px] text-danger">{(test.error ?? save.error)?.message}</span>
          )}
          {test.isSuccess && <span className="text-[13px] text-success">Connection works</span>}
          {save.isSuccess && !test.isSuccess && <span className="text-[13px] text-success">Saved</span>}
          {s3 && (
            <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
              Save and test
            </Button>
          )}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Card>
  )
}

type OAuthProvider = {
  id: string
  label: string
  enabled: boolean
  clientId: string
  clientSecret: string
  callbackUrl: string
}

function OAuthRow({ p }: { p: OAuthProvider }) {
  const qc = useQueryClient()
  const [v, setV] = useState(p)
  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/oauth/${p.id}`, {
        enabled: v.enabled,
        clientId: v.clientId,
        clientSecret: v.clientSecret,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'oauth'] }),
  })
  return (
    <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{p.label}</span>
        <Toggle
          checked={v.enabled}
          onChange={(x) => setV({ ...v, enabled: x })}
          label={`Enable ${p.label}`}
        />
      </div>
      <p className="text-xs text-muted">
        Callback URL: <code className="break-all">{p.callbackUrl}</code>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Client ID">
          <Input
            value={v.clientId}
            autoComplete="off"
            onChange={(e) => setV({ ...v, clientId: e.target.value })}
          />
        </Field>
        <Field label="Client secret">
          <Input
            type="password"
            value={v.clientSecret}
            autoComplete="new-password"
            onChange={(e) => setV({ ...v, clientSecret: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3">
        {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
        {save.isSuccess && <span className="text-[13px] text-success">Saved</span>}
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** Discord, Google and GitHub sign in. */
export function OAuthCard() {
  const { data } = useQuery({
    queryKey: ['admin', 'oauth'],
    queryFn: () => api.get<{ data: OAuthProvider[] }>('/admin/oauth').then((r) => r.data),
  })
  return (
    <Card>
      <CardHeader
        title="Sign in with"
        subtitle="Let customers sign in with another account. Existing accounts are only linked when the provider confirms the email address."
      />
      <div className="grid gap-3 px-5 pb-5 lg:grid-cols-3">
        {data?.map((p) => (
          <OAuthRow key={p.id} p={p} />
        ))}
      </div>
    </Card>
  )
}

type Currency = { code: string; prefix: string; suffix: string; rate: string; isDefault: boolean }
type TaxRate = { id: number; name: string; rate: string; country: string | null }

/** Currencies with exchange rates, and tax rates per country. */
export function CurrenciesTaxCard() {
  const qc = useQueryClient()
  const currencies = useQuery({
    queryKey: ['admin', 'currencies'],
    queryFn: () => api.get<{ data: Currency[] }>('/admin/currencies').then((r) => r.data),
  })
  const taxes = useQuery({
    queryKey: ['admin', 'tax-rates'],
    queryFn: () => api.get<{ data: TaxRate[] }>('/admin/tax-rates').then((r) => r.data),
  })
  const [cur, setCur] = useState({ code: '', rate: '1', prefix: '', isDefault: false })
  const [tax, setTax] = useState({ name: 'VAT', rate: '', country: '' })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'currencies'] })
    qc.invalidateQueries({ queryKey: ['currencies'] })
  }
  const saveCur = useMutation({
    mutationFn: (c: { code: string; rate: string; prefix: string; isDefault: boolean }) =>
      api.put(`/admin/currencies/${c.code.toUpperCase()}`, {
        prefix: c.prefix,
        suffix: '',
        rate: Number(c.rate),
        isDefault: c.isDefault,
      }),
    onSuccess: () => {
      setCur({ code: '', rate: '1', prefix: '', isDefault: false })
      refresh()
    },
  })
  const addTax = useMutation({
    mutationFn: () =>
      api.post('/admin/tax-rates', { name: tax.name, rate: Number(tax.rate), country: tax.country || null }),
    onSuccess: () => {
      setTax({ name: 'VAT', rate: '', country: '' })
      qc.invalidateQueries({ queryKey: ['admin', 'tax-rates'] })
    },
  })
  const delTax = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/tax-rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tax-rates'] }),
  })
  return (
    <Card>
      <CardHeader
        title="Currencies and taxes"
        subtitle="Prices without an amount in a currency are converted from the default currency with its rate. Turn taxes on under Settings."
      />
      <div className="grid gap-6 px-5 pb-5 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Currencies</p>
          {currencies.data?.map((c) => (
            <div
              key={c.code}
              className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]"
            >
              <span className="w-12 font-medium">{c.code}</span>
              <span className="flex-1 text-muted">rate {Number(c.rate)}</span>
              {c.isDefault ? (
                <Pill tone="info">Default</Pill>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    saveCur.mutate({ code: c.code, rate: c.rate, prefix: c.prefix, isDefault: true })
                  }
                >
                  Make default
                </Button>
              )}
            </div>
          ))}
          <form
            className="flex flex-wrap items-end gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              saveCur.mutate(cur)
            }}
          >
            <Field label="Code">
              <Input
                className="w-20"
                maxLength={3}
                placeholder="EUR"
                value={cur.code}
                onChange={(e) => setCur({ ...cur, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Rate">
              <Input
                className="w-24"
                type="number"
                step="0.0001"
                value={cur.rate}
                onChange={(e) => setCur({ ...cur, rate: e.target.value })}
              />
            </Field>
            <Button
              type="submit"
              variant="outline"
              loading={saveCur.isPending}
              disabled={cur.code.length !== 3}
            >
              Add
            </Button>
          </form>
          {saveCur.error && <p className="text-[13px] text-danger">{saveCur.error.message}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Tax rates</p>
          {taxes.data?.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]"
            >
              <span className="flex-1 font-medium">
                {t.name} {Number(t.rate)}%
              </span>
              <span className="text-muted">{t.country ?? 'All countries'}</span>
              <Button size="sm" variant="ghost" onClick={() => delTax.mutate(t.id)}>
                Remove
              </Button>
            </div>
          ))}
          {taxes.data?.length === 0 && <p className="text-[13px] text-muted">No tax rates.</p>}
          <form
            className="flex flex-wrap items-end gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault()
              addTax.mutate()
            }}
          >
            <Field label="Name">
              <Input
                className="w-24"
                value={tax.name}
                onChange={(e) => setTax({ ...tax, name: e.target.value })}
              />
            </Field>
            <Field label="Rate %">
              <Input
                className="w-20"
                type="number"
                step="0.01"
                value={tax.rate}
                onChange={(e) => setTax({ ...tax, rate: e.target.value })}
              />
            </Field>
            <Field label="Country" hint="Empty = all">
              <Input
                className="w-20"
                maxLength={2}
                value={tax.country}
                onChange={(e) => setTax({ ...tax, country: e.target.value.toUpperCase() })}
              />
            </Field>
            <Button type="submit" variant="outline" loading={addTax.isPending} disabled={!tax.rate}>
              Add
            </Button>
          </form>
          {addTax.error && <p className="text-[13px] text-danger">{addTax.error.message}</p>}
        </div>
      </div>
    </Card>
  )
}

type Mount = {
  id: number
  name: string
  description: string | null
  source: string
  target: string
  readOnly: boolean
  servers: number[]
}

export function AdminMountsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'mounts'],
    queryFn: () => api.get<{ data: Mount[] }>('/admin/mounts').then((r) => r.data),
  })
  const [form, setForm] = useState({ name: '', source: '', target: '', readOnly: true })
  const create = useMutation({
    mutationFn: () => api.post('/admin/mounts', form),
    onSuccess: () => {
      setForm({ name: '', source: '', target: '', readOnly: true })
      qc.invalidateQueries({ queryKey: ['admin', 'mounts'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/mounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mounts'] }),
  })
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Mounts"
          subtitle="Folders on the node shared into servers, e.g. a modpack library. Attach them to servers in the server editor."
        />
        <div className="divide-y divide-line border-t border-line">
          {data?.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
              <span className="min-w-40 flex-1">
                <span className="font-medium">{m.name}</span>
                <code className="block text-xs text-muted">
                  {m.source} → {m.target}
                </code>
              </span>
              {m.readOnly && <Pill>Read only</Pill>}
              <span className="text-xs text-muted">{m.servers.length} servers</span>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)}>
                Delete
              </Button>
            </div>
          ))}
          {data?.length === 0 && <Empty title="No mounts" />}
        </div>
      </Card>
      <Card>
        <CardHeader title="New mount" />
        <form
          className="space-y-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Path on the node" hint="Must exist on every node it is used on">
            <Input
              placeholder="/srv/modpacks"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </Field>
          <Field label="Path in the server">
            <Input
              placeholder="/mnt/modpacks"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
            />
          </Field>
          <span className="flex items-center gap-3 text-[13px]">
            <Toggle
              checked={form.readOnly}
              onChange={(v) => setForm({ ...form, readOnly: v })}
              label="Read only"
            />{' '}
            Read only
          </span>
          {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
          <Button type="submit" loading={create.isPending}>
            Create mount
          </Button>
        </form>
      </Card>
    </div>
  )
}

/** Mount picker for the admin server editor. */
export function ServerMountsCard({ serverId }: { serverId: number }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'mounts'],
    queryFn: () => api.get<{ data: Mount[] }>('/admin/mounts').then((r) => r.data),
  })
  const toggle = useMutation({
    mutationFn: ({ id, attached }: { id: number; attached: boolean }) =>
      api.put(`/admin/servers/${serverId}/mounts/${id}`, { attached }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mounts'] }),
  })
  if (!data?.length) return null
  return (
    <Card>
      <CardHeader title="Mounts" subtitle="Applies the next time the server starts." />
      <div className="flex flex-wrap gap-2 px-5 pb-5">
        {data.map((m) => (
          <label
            key={m.id}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px]"
          >
            <input
              type="checkbox"
              checked={m.servers.includes(serverId)}
              onChange={(e) => toggle.mutate({ id: m.id, attached: e.target.checked })}
            />
            {m.name} <code className="text-xs text-muted">{m.target}</code>
          </label>
        ))}
        {toggle.error && <p className="w-full text-[13px] text-danger">{toggle.error.message}</p>}
      </div>
    </Card>
  )
}

/** Create a one-off invoice for a customer. */
export function ManualInvoiceCard({ userId }: { userId: number }) {
  const qc = useQueryClient()
  const [items, setItems] = useState([{ description: '', price: '', quantity: 1 }])
  const [notify, setNotify] = useState(true)
  const create = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: number } }>('/admin/invoices', {
        userId,
        items: items.filter((i) => i.description && i.price),
        notify,
      }),
    onSuccess: () => {
      setItems([{ description: '', price: '', quantity: 1 }])
      qc.invalidateQueries({ queryKey: ['admin', 'user', String(userId)] })
    },
  })
  return (
    <Card>
      <CardHeader title="Create invoice" subtitle="For one-off work or fees." />
      <div className="space-y-2 px-5 pb-5">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="Description"
              value={it.description}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
              }
            />
            <Input
              className="w-24"
              type="number"
              step="0.01"
              placeholder="Price"
              value={it.price}
              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
            />
            <Input
              className="w-16"
              type="number"
              min={1}
              value={it.quantity}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))
              }
              aria-label="Quantity"
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setItems([...items, { description: '', price: '', quantity: 1 }])}
          >
            + Line
          </Button>
          <span className="flex items-center gap-3 text-[13px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email
              the customer
            </label>
            <Button
              size="sm"
              loading={create.isPending}
              disabled={!items.some((i) => i.description && i.price)}
              onClick={() => create.mutate()}
            >
              Create
            </Button>
          </span>
        </div>
        {create.isSuccess && <p className="text-[13px] text-success">Invoice created.</p>}
        {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
      </div>
    </Card>
  )
}
