import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { LogIn, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill } from '../../components/ui'
import { api, formatDate, formatMoney } from '../../lib/api'
import { invoiceTone, statusLabel } from '../billing/invoices'
import { serviceTone } from '../billing/services'
import { ManualInvoiceCard } from './content'

type Role = { id: number; name: string; permissions: string[]; users: number }
type UserRow = {
  id: number
  email: string
  username: string
  firstName: string | null
  lastName: string | null
  role: string | null
  roleId: number | null
  servers: number
  suspended: boolean
  twoFactorEnabled: boolean
  credits: Record<string, string>
  country: string | null
  createdAt: string
}
type UserDetail = UserRow & {
  servers: { id: number; uuidShort: string; name: string; status: string | null }[]
  services: { id: number; status: string; product: string; price: string; currency: string }[]
  invoices: { id: number; number: string; status: string; dueAt: string }[]
  activity: { id: number; event: string; ip: string | null; createdAt: string }[]
}

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'
const useRoles = () =>
  useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ data: Role[]; available: Record<string, string> }>('/admin/roles'),
  })

export function AdminUsersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<null | {
    email: string
    username: string
    password: string
    firstName: string
    lastName: string
    roleId: string
  }>(null)
  const roles = useRoles()
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q)
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useQuery({
    queryKey: ['admin', 'users', search, page],
    queryFn: () =>
      api.get<{ data: UserRow[]; total: number }>(
        `/admin/users?q=${encodeURIComponent(search)}&page=${page}`,
      ),
    placeholderData: (p) => p,
  })
  const create = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: number } }>('/admin/users', {
        ...form,
        roleId: form!.roleId ? Number(form!.roleId) : null,
      }),
    onSuccess: ({ data: u }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      navigate({ to: '/admin/users/$id', params: { id: String(u.id) } })
    },
  })
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50))
  return (
    <Card>
      <CardHeader
        title="Users"
        subtitle={data ? `${data.total} users` : undefined}
        action={
          <div className="flex gap-2">
            <Link
              to="/admin/roles"
              className="inline-flex h-10 items-center rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
            >
              Roles
            </Link>
            <Button
              onClick={() =>
                setForm({ email: '', username: '', password: '', firstName: '', lastName: '', roleId: '' })
              }
            >
              <Plus className="size-4" /> New user
            </Button>
          </div>
        }
      />
      <div className="px-5 pb-4">
        <Input
          icon={<Search className="size-4" />}
          placeholder="Search by email, username or name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((u) => (
          <Link
            key={u.id}
            to="/admin/users/$id"
            params={{ id: String(u.id) }}
            className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-surface-2"
          >
            <span className="w-10 text-xs text-muted">#{u.id}</span>
            <span className="min-w-48 flex-1">
              <span className="font-medium">
                {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.username}
              </span>
              <span className="block text-xs text-muted">{u.email}</span>
            </span>
            {u.role && <Pill tone="info">{u.role}</Pill>}
            {u.suspended && <Pill tone="danger">Suspended</Pill>}
            {u.twoFactorEnabled && <Pill tone="success">2FA</Pill>}
            <span className="w-20 text-right text-xs text-muted">{u.servers} servers</span>
            <span className="w-28 text-right text-xs text-muted">{formatDate(u.createdAt)}</span>
          </Link>
        ))}
        {data?.data.length === 0 && <Empty title="No users found" />}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-5 py-3 text-[13px]">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New user"
        footer={
          <>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid grid-cols-2 gap-3 text-fg">
            <Field label="First name">
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Username">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <select
                className={selectClass}
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">Customer</option>
                {roles.data?.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            {create.error && <p className="col-span-2 text-danger">{create.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

export function AdminUserPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const navigate = useNavigate()
  const roles = useRoles()
  const { data, error } = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => api.get<{ data: UserDetail }>(`/admin/users/${id}`).then((r) => r.data),
  })
  const [form, setForm] = useState({
    email: '',
    username: '',
    firstName: '',
    lastName: '',
    roleId: '',
    country: '',
    password: '',
  })
  const [credit, setCredit] = useState({ amount: '', note: '' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (data)
      setForm({
        email: data.email,
        username: data.username,
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        roleId: data.roleId ? String(data.roleId) : '',
        country: data.country ?? '',
        password: '',
      })
  }, [data])
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'user', id] })
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/admin/users/${id}`, {
        email: form.email,
        username: form.username,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        roleId: form.roleId ? Number(form.roleId) : null,
        country: form.country || null,
        ...(form.password ? { password: form.password } : {}),
      }),
    onSuccess: refresh,
  })
  const suspend = useMutation({
    mutationFn: (v: boolean) => api.patch(`/admin/users/${id}`, { suspended: v }),
    onSuccess: refresh,
  })
  const addCredit = useMutation({
    mutationFn: () =>
      api.post(`/admin/users/${id}/credits`, { amount: credit.amount, currency: 'USD', note: credit.note }),
    onSuccess: () => {
      setCredit({ amount: '', note: '' })
      refresh()
    },
  })
  const impersonate = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/impersonate`),
    onSuccess: async () => {
      await qc.invalidateQueries()
      navigate({ to: '/' })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/users/${id}`),
    onSuccess: () => navigate({ to: '/admin/users' }),
  })
  if (error)
    return (
      <Card>
        <Empty title="User not found" />
      </Card>
    )
  if (!data) return null
  const balance = Object.entries(data.credits)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-medium">
                {[data.firstName, data.lastName].filter(Boolean).join(' ') || data.username}
                {data.suspended && <Pill tone="danger">Suspended</Pill>}
              </h2>
              <p className="text-[13px] text-muted">
                #{data.id} · joined {formatDate(data.createdAt)} ·{' '}
                {data.twoFactorEnabled ? '2FA on' : '2FA off'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                loading={impersonate.isPending}
                disabled={data.suspended}
                onClick={() => impersonate.mutate()}
              >
                <LogIn className="size-4" /> Sign in as user
              </Button>
              <Button
                variant="outline"
                loading={suspend.isPending}
                onClick={() => suspend.mutate(!data.suspended)}
              >
                {data.suspended ? 'Unsuspend' : 'Suspend'}
              </Button>
            </div>
          </div>
          {(impersonate.error || suspend.error) && (
            <p className="px-5 pb-4 text-[13px] text-danger">
              {(impersonate.error ?? suspend.error)?.message}
            </p>
          )}
          <form
            className="grid gap-4 border-t border-line p-5 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
          >
            <Field label="First name">
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Username">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Role">
              <select
                className={selectClass}
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">Customer</option>
                {roles.data?.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Country" hint="2 letter code, used for taxes">
              <Input
                maxLength={2}
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="New password" hint="Leave empty to keep the current password">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <div className="flex items-end justify-end gap-3 md:col-span-2">
              {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
              {save.isSuccess && <span className="text-[13px] text-success">Saved</span>}
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          <CardHeader title="Servers" />
          <div className="divide-y divide-line border-t border-line">
            {data.servers.map((s) => (
              <Link
                key={s.id}
                to="/admin/servers/$id"
                params={{ id: String(s.id) }}
                className="flex items-center justify-between px-5 py-3 text-[13.5px] hover:bg-surface-2"
              >
                <span className="font-medium">{s.name}</span>
                {s.status ? (
                  <Pill tone="warn">{s.status}</Pill>
                ) : (
                  <code className="text-xs text-muted">{s.uuidShort}</code>
                )}
              </Link>
            ))}
            {data.servers.length === 0 && <Empty title="No servers" />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Services" />
          <div className="divide-y divide-line border-t border-line">
            {data.services.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                <span className="flex-1 font-medium">{s.product}</span>
                <span className="text-muted">{formatMoney(s.price, s.currency)}</span>
                <Pill tone={serviceTone[s.status as keyof typeof serviceTone] ?? 'neutral'} dot>
                  {statusLabel(s.status)}
                </Pill>
              </div>
            ))}
            {data.services.length === 0 && <Empty title="No services" />}
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Credit balance"
            subtitle={
              balance.length ? balance.map(([c, v]) => formatMoney(v, c)).join(' · ') : formatMoney(0)
            }
          />
          <form
            className="flex flex-wrap items-end gap-2 px-5 pb-5"
            onSubmit={(e) => {
              e.preventDefault()
              addCredit.mutate()
            }}
          >
            <Field label="Amount (negative to remove)">
              <Input
                type="number"
                step="0.01"
                className="w-36"
                value={credit.amount}
                onChange={(e) => setCredit({ ...credit, amount: e.target.value })}
              />
            </Field>
            <Field label="Note">
              <Input
                className="w-40"
                value={credit.note}
                onChange={(e) => setCredit({ ...credit, note: e.target.value })}
              />
            </Field>
            <Button type="submit" variant="outline" loading={addCredit.isPending} disabled={!credit.amount}>
              Apply
            </Button>
            {addCredit.error && <p className="w-full text-[13px] text-danger">{addCredit.error.message}</p>}
          </form>
        </Card>
        <ManualInvoiceCard userId={data.id} />
        <Card>
          <CardHeader title="Invoices" />
          <div className="divide-y divide-line border-t border-line">
            {data.invoices.map((i) => (
              <div key={i.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
                <span className="font-medium">{i.number}</span>
                <span className="text-muted">{formatDate(i.dueAt)}</span>
                <Pill tone={invoiceTone[i.status as keyof typeof invoiceTone] ?? 'neutral'}>
                  {statusLabel(i.status)}
                </Pill>
              </div>
            ))}
            {data.invoices.length === 0 && <Empty title="No invoices" />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <div className="divide-y divide-line border-t border-line">
            {data.activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-2 text-xs">
                <code className="truncate">{a.event}</code>
                <span className="text-muted">
                  {a.ip ?? ''} {formatDate(a.createdAt, true)}
                </span>
              </div>
            ))}
            {data.activity.length === 0 && <Empty title="No activity" />}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Delete user"
            subtitle="Only possible when the user has no servers, active services or invoices."
          />
          <div className="px-5 pb-5">
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete user
            </Button>
          </div>
        </Card>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${data.email}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </>
        }
      >
        This cannot be undone.
        {remove.error && <p className="mt-2 text-danger">{remove.error.message}</p>}
      </Modal>
    </div>
  )
}

export function AdminRolesPage() {
  const qc = useQueryClient()
  const roles = useRoles()
  const [edit, setEdit] = useState<{ id?: number; name: string; permissions: string[] } | null>(null)
  const save = useMutation({
    mutationFn: () => (edit!.id ? api.put(`/admin/roles/${edit!.id}`, edit) : api.post('/admin/roles', edit)),
    onSuccess: () => {
      setEdit(null)
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
  const available = Object.entries(roles.data?.available ?? {})
  return (
    <Card>
      <CardHeader
        title="Roles"
        subtitle="Staff roles and what they can do in the admin area."
        action={
          <Button onClick={() => setEdit({ name: '', permissions: ['admin.dashboard'] })}>
            <Plus className="size-4" /> New role
          </Button>
        }
      />
      {remove.error && <p className="px-5 pb-3 text-[13px] text-danger">{remove.error.message}</p>}
      <div className="divide-y divide-line border-t border-line">
        {roles.data?.data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <span className="flex-1 font-medium">{r.name}</span>
            <span className="text-xs text-muted">
              {r.permissions.includes('*') ? 'All permissions' : `${r.permissions.length} permissions`} ·{' '}
              {r.users} users
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEdit({ id: r.id, name: r.name, permissions: r.permissions })}
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
              Delete
            </Button>
          </div>
        ))}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit role' : 'New role'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3 text-fg">
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                checked={edit.permissions.includes('*')}
                onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? ['*'] : [] })}
              />{' '}
              Full administrator (everything)
            </label>
            {!edit.permissions.includes('*') && (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {available.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={edit.permissions.includes(key)}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          permissions: e.target.checked
                            ? [...edit.permissions, key]
                            : edit.permissions.filter((p) => p !== key),
                        })
                      }
                    />
                    {label} <code className="text-subtle">{key}</code>
                  </label>
                ))}
              </div>
            )}
            {save.error && <p className="text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}
