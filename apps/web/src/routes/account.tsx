import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Monitor, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill } from '../components/ui'
import { api, formatDate } from '../lib/api'
import { useUser } from '../lib/auth'
import { type ThemeMode, useThemeMode } from '../lib/theme'

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

function ProfileCard() {
  const user = useUser()!
  const qc = useQueryClient()
  const { mode, setMode } = useThemeMode()
  const [form, setForm] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    country: user.country ?? '',
  })
  const save = useMutation({
    mutationFn: () =>
      api.patch('/account', {
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        country: form.country || null,
        theme: mode,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  return (
    <Card>
      <CardHeader title="Profile" subtitle={`Signed in as ${user.username}`} />
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="First name">
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </Field>
        <Field label="Country" hint="Two letter code, e.g. ID or DE. Used for taxes.">
          <Input
            maxLength={2}
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Appearance">
          <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
            <option value="system">Match my device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <div className="flex items-center justify-end gap-3 md:col-span-3">
          {save.isSuccess && <span className="text-[13px] text-success">Saved</span>}
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}

function EmailCard() {
  const user = useUser()!
  const qc = useQueryClient()
  const [form, setForm] = useState({ email: '', password: '' })
  const save = useMutation({
    mutationFn: () => api.put('/account/email', form),
    onSuccess: () => {
      setForm({ email: '', password: '' })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  return (
    <Card>
      <CardHeader
        title="Email address"
        subtitle={`Currently ${user.email}${user.emailVerified ? '' : ' (not confirmed)'}`}
      />
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="New email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 md:col-span-2">
          {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
          {save.isSuccess && (
            <span className="text-[13px] text-success">
              Updated. Check your inbox to confirm the new address.
            </span>
          )}
          <Button type="submit" loading={save.isPending} disabled={!form.email || !form.password}>
            Change email
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordCard() {
  const [form, setForm] = useState({ currentPassword: '', password: '', confirm: '' })
  const save = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirm) throw new Error('The new passwords do not match')
      return api.put('/account/password', { currentPassword: form.currentPassword, password: form.password })
    },
    onSuccess: () => setForm({ currentPassword: '', password: '', confirm: '' }),
  })
  return (
    <Card>
      <CardHeader title="Password" />
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 md:col-span-3">
          {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
          {save.isSuccess && <span className="text-[13px] text-success">Password changed</span>}
          <Button type="submit" loading={save.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [text])
  // The SVG is generated locally from the otpauth URI, not from user HTML.
  return (
    <div
      className="size-44 rounded-[12px] border border-line bg-white p-1"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function TwoFactorCard() {
  const user = useUser()!
  const qc = useQueryClient()
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [disable, setDisable] = useState(false)
  const start = useMutation({
    mutationFn: () => api.get<{ secret: string; uri: string }>('/account/two-factor'),
    onSuccess: setSetup,
  })
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/account/two-factor', { code, password }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes)
      setSetup(null)
      setCode('')
      setPassword('')
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const off = useMutation({
    mutationFn: () => api.delete('/account/two-factor', { password }),
    onSuccess: () => {
      setDisable(false)
      setPassword('')
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        subtitle="A code from an authenticator app is asked at every sign in."
        action={
          user.twoFactorEnabled ? (
            <Pill tone="success" dot>
              Enabled
            </Pill>
          ) : (
            <Pill tone="warn">Off</Pill>
          )
        }
      />
      <div className="px-5 pb-5">
        {codes ? (
          <div className="space-y-3">
            <p className="text-[13px]">
              Save these recovery codes somewhere safe. Each one signs you in once if you lose your device.
              They are not shown again.
            </p>
            <pre className="grid grid-cols-2 gap-1 rounded-[10px] bg-surface-2 p-3 font-mono text-[13px] sm:grid-cols-5">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </pre>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>
                <Copy className="size-4" /> Copy
              </Button>
              <Button onClick={() => setCodes(null)}>I saved them</Button>
            </div>
          </div>
        ) : user.twoFactorEnabled ? (
          <Button variant="outline" onClick={() => setDisable(true)}>
            Disable two-factor
          </Button>
        ) : setup ? (
          <form
            className="flex flex-wrap items-start gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              enable.mutate()
            }}
          >
            <Qr text={setup.uri} />
            <div className="min-w-64 flex-1 space-y-3">
              <p className="text-[13px] text-muted">
                Scan the code with Google Authenticator, 1Password, Authy or similar, or enter this key:
              </p>
              <code className="block rounded-lg bg-surface-2 px-3 py-2 text-[13px] break-all">
                {setup.secret}
              </code>
              <Field label="6 digit code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Field label="Your password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {enable.error && <p className="text-[13px] text-danger">{enable.error.message}</p>}
              <Button type="submit" loading={enable.isPending} disabled={code.length !== 6 || !password}>
                Enable
              </Button>
            </div>
          </form>
        ) : (
          <Button loading={start.isPending} onClick={() => start.mutate()}>
            <ShieldCheck className="size-4" /> Set up two-factor
          </Button>
        )}
      </div>
      <Modal
        open={disable}
        onClose={() => setDisable(false)}
        title="Disable two-factor authentication?"
        footer={
          <>
            <Button variant="outline" onClick={() => setDisable(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={off.isPending} onClick={() => off.mutate()}>
              Disable
            </Button>
          </>
        }
      >
        <Field label="Your password">
          <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {off.error && <p className="mt-2 text-danger">{off.error.message}</p>}
      </Modal>
    </Card>
  )
}

function ConnectedAccountsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['oauth-accounts'],
    queryFn: () =>
      api.get<{
        data: { provider: string; label: string; createdAt: string }[]
        available: { id: string; label: string }[]
      }>('/account/oauth'),
  })
  const unlink = useMutation({
    mutationFn: (p: string) => api.delete(`/account/oauth/${p}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oauth-accounts'] }),
  })
  const message = useMemo(() => {
    const q = new URLSearchParams(location.search)
    return q.get('oauth_error') ?? (q.get('oauth_linked') ? 'Account connected.' : null)
  }, [])
  if (!data || (!data.available.length && !data.data.length)) return null
  return (
    <Card>
      <CardHeader
        title="Connected accounts"
        subtitle="Sign in with another account instead of your password."
      />
      {message && <p className="px-5 pb-3 text-[13px] text-muted">{message}</p>}
      <div className="divide-y divide-line border-t border-line">
        {data.available.map((p) => {
          const linked = data.data.find((l) => l.provider === p.id)
          return (
            <div key={p.id} className="flex items-center justify-between px-5 py-3 text-[13.5px]">
              <span className="font-medium">{p.label}</span>
              {linked ? (
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">Connected {formatDate(linked.createdAt)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={unlink.isPending && unlink.variables === p.id}
                    onClick={() => unlink.mutate(p.id)}
                  >
                    Disconnect
                  </Button>
                </span>
              ) : (
                <a
                  href={`/api/auth/oauth/${p.id}/redirect?link=1`}
                  className="inline-flex h-8 items-center rounded-[10px] border border-line px-3 text-[13px] hover:bg-surface-2"
                >
                  Connect
                </a>
              )}
            </div>
          )
        })}
      </div>
      {unlink.error && <p className="px-5 py-3 text-[13px] text-danger">{unlink.error.message}</p>}
    </Card>
  )
}

type ApiKey = {
  identifier: string
  description: string
  allowedIps: string[]
  lastUsedAt: string | null
  createdAt: string
}

function ApiKeysCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ data: ApiKey[] }>('/account/api-keys'),
  })
  const [form, setForm] = useState<{ description: string; ips: string } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: string }>('/account/api-keys', {
        description: form!.description,
        allowedIps: form!.ips.split(/[\s,]+/).filter(Boolean),
      }),
    onSuccess: (r) => {
      setForm(null)
      setToken(r.token)
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/account/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
  return (
    <Card>
      <CardHeader
        title="API keys"
        subtitle="Use the panel API from scripts and bots. Keys act as you."
        action={
          <Button variant="outline" onClick={() => setForm({ description: '', ips: '' })}>
            <Plus className="size-4" /> New key
          </Button>
        }
      />
      {token && (
        <div className="mx-5 mb-4 space-y-2 rounded-[12px] border border-line bg-success-bg p-4 text-[13px]">
          <p className="text-success">Copy your key now, it is shown only once.</p>
          <div className="flex gap-2">
            <code className="flex-1 rounded-lg bg-surface px-3 py-2 break-all">{token}</code>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(token)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setToken(null)}>
            Done
          </Button>
        </div>
      )}
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((k) => (
          <div key={k.identifier} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
            <KeyRound className="size-4 text-subtle" />
            <span className="min-w-40 flex-1">
              <span className="font-medium">{k.description}</span>
              <code className="block text-xs text-muted">amn_{k.identifier}…</code>
            </span>
            <span className="text-xs text-muted">
              {k.allowedIps.length ? `Only ${k.allowedIps.join(', ')}` : 'Any IP'}
            </span>
            <span className="text-xs text-muted">
              {k.lastUsedAt ? `Used ${formatDate(k.lastUsedAt, true)}` : 'Never used'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete key ${k.description}`}
              onClick={() => remove.mutate(k.identifier)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No API keys" />}
      </div>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New API key"
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
          <div className="space-y-3 text-fg">
            <Field label="Description">
              <Input
                autoFocus
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="Allowed IPs" hint="Optional, comma separated">
              <Input value={form.ips} onChange={(e) => setForm({ ...form, ips: e.target.value })} />
            </Field>
            {create.error && <p className="text-danger">{create.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

function SshKeysCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: () =>
      api.get<{ data: { id: number; name: string; fingerprint: string; createdAt: string }[] }>(
        '/account/ssh-keys',
      ),
  })
  const [form, setForm] = useState<{ name: string; publicKey: string } | null>(null)
  const create = useMutation({
    mutationFn: () => api.post('/account/ssh-keys', form),
    onSuccess: () => {
      setForm(null)
      qc.invalidateQueries({ queryKey: ['ssh-keys'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/account/ssh-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ssh-keys'] }),
  })
  return (
    <Card>
      <CardHeader
        title="SSH keys"
        subtitle="Sign in to SFTP with a key instead of your password."
        action={
          <Button variant="outline" onClick={() => setForm({ name: '', publicKey: '' })}>
            <Plus className="size-4" /> Add key
          </Button>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((k) => (
          <div key={k.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
            <span className="min-w-40 flex-1">
              <span className="font-medium">{k.name}</span>
              <code className="block text-xs text-muted">{k.fingerprint}</code>
            </span>
            <span className="text-xs text-muted">Added {formatDate(k.createdAt)}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${k.name}`}
              onClick={() => remove.mutate(k.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No SSH keys" />}
      </div>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Add SSH key"
        footer={
          <>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              Add
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3 text-fg">
            <Field label="Name">
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Public key" hint="Starts with ssh-ed25519, ssh-rsa or ecdsa-sha2">
              <textarea
                className="h-28 w-full rounded-[10px] border border-line bg-surface p-3 font-mono text-xs"
                value={form.publicKey}
                onChange={(e) => setForm({ ...form, publicKey: e.target.value })}
              />
            </Field>
            {create.error && <p className="text-danger">{create.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

function SessionsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<{
        data: {
          id: string
          ip: string | null
          userAgent: string | null
          lastSeenAt: string
          current: boolean
        }[]
      }>('/account/sessions'),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/account/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
  const others = useMutation({
    mutationFn: () => api.delete('/account/sessions'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
  const browser = (ua: string | null) => {
    if (!ua) return 'Unknown device'
    const b = /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Mac OS/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad/.test(ua)
            ? 'iOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : ''
    return `${b}${os ? ` on ${os}` : ''}`
  }
  return (
    <Card>
      <CardHeader
        title="Active sessions"
        action={
          (data?.data.length ?? 0) > 1 && (
            <Button variant="outline" loading={others.isPending} onClick={() => others.mutate()}>
              Sign out other sessions
            </Button>
          )
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
            <Monitor className="size-4 text-subtle" />
            <span className="flex-1">
              <span className="font-medium">{browser(s.userAgent)}</span>
              <span className="block text-xs text-muted">
                {s.ip ?? 'Unknown IP'} · last active {formatDate(s.lastSeenAt, true)}
              </span>
            </span>
            {s.current ? (
              <Pill tone="success">This device</Pill>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                Sign out
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function AccountPage() {
  return (
    <>
      <ProfileCard />
      <EmailCard />
      <PasswordCard />
    </>
  )
}

export function SecurityPage() {
  const user = useUser()
  // Scroll to the section linked from elsewhere (e.g. #two-factor).
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [])
  if (!user) return null
  return (
    <>
      <div id="two-factor">
        <TwoFactorCard />
      </div>
      <ConnectedAccountsCard />
      <SessionsCard />
      <ApiKeysCard />
      <SshKeysCard />
    </>
  )
}
