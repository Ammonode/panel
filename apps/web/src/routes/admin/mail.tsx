import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, cn, Field, Input, Pill, Toggle } from '../../components/ui'
import { api } from '../../lib/api'

type Template = {
  key: string
  subject: string
  body: string
  enabled: boolean
  customized: boolean
  variables: string[]
  default: { subject: string; body: string }
}
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

function SmtpCard() {
  const { data } = useQuery({
    queryKey: ['admin', 'mail'],
    queryFn: () => api.get<{ data: Record<string, string | number> }>('/admin/mail').then((r) => r.data),
  })
  const [form, setForm] = useState<Record<string, string | number>>({})
  useEffect(() => {
    if (data) setForm(data)
  }, [data])
  const save = useMutation({
    mutationFn: () => api.put('/admin/mail', { ...form, 'mail.port': Number(form['mail.port']) || 587 }),
  })
  const test = useMutation({ mutationFn: () => api.post<{ to: string }>('/admin/mail/test') })
  const f = (k: string) => String(form[k] ?? '')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <Card>
      <CardHeader
        title="Email delivery"
        subtitle="SMTP server used for invoices, password resets and ticket replies."
      />
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="SMTP host">
          <Input value={f('mail.host')} placeholder="smtp.example.com" onChange={set('mail.host')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <Input type="number" value={f('mail.port')} onChange={set('mail.port')} />
          </Field>
          <Field label="Encryption">
            <select className={selectClass} value={f('mail.encryption')} onChange={set('mail.encryption')}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">TLS</option>
              <option value="none">None</option>
            </select>
          </Field>
        </div>
        <Field label="Username">
          <Input value={f('mail.username')} autoComplete="off" onChange={set('mail.username')} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={f('mail.password')}
            autoComplete="new-password"
            onChange={set('mail.password')}
          />
        </Field>
        <Field label="From address">
          <Input
            type="email"
            value={f('mail.from_address')}
            placeholder="billing@example.com"
            onChange={set('mail.from_address')}
          />
        </Field>
        <Field label="From name">
          <Input value={f('mail.from_name')} onChange={set('mail.from_name')} />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-2">
          {(save.error || test.error) && (
            <span className="text-[13px] text-danger">{(save.error ?? test.error)?.message}</span>
          )}
          {test.isSuccess && (
            <span className="text-[13px] text-success">Test email sent to {test.data.to}</span>
          )}
          {save.isSuccess && !test.isSuccess && <span className="text-[13px] text-success">Saved</span>}
          <Button type="button" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
            Send test email
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}

function TemplatesCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'email-templates'],
    queryFn: () => api.get<{ data: Template[] }>('/admin/email-templates').then((r) => r.data),
  })
  const [key, setKey] = useState<string | null>(null)
  const current = data?.find((t) => t.key === key) ?? data?.[0]
  const [form, setForm] = useState({ subject: '', body: '', enabled: true })
  useEffect(() => {
    if (current) setForm({ subject: current.subject, body: current.body, enabled: current.enabled })
  }, [current])
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'email-templates'] })
  const save = useMutation({
    mutationFn: () => api.put(`/admin/email-templates/${current!.key}`, form),
    onSuccess: () => {
      refresh()
      preview.mutate()
    },
  })
  const reset = useMutation({
    mutationFn: () => api.delete(`/admin/email-templates/${current!.key}`),
    onSuccess: refresh,
  })
  const preview = useMutation({
    mutationFn: () =>
      api
        .post<{ data: { subject: string; html: string } }>(`/admin/email-templates/${current!.key}/preview`)
        .then((r) => r.data),
  })
  // Refresh the preview when switching templates.
  useEffect(() => {
    if (current) preview.mutate()
  }, [current?.key])
  if (!data || !current) return null
  return (
    <Card>
      <CardHeader
        title="Email templates"
        subtitle="Use **bold**, [link text](url) and {{variables}}. A link on its own line becomes a button."
      />
      <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        <nav className="space-y-1">
          {data.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => setKey(t.key)}
              className={cn(
                'flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[13px]',
                t.key === current.key ? 'bg-nav text-nav-fg' : 'hover:bg-surface-2',
              )}
            >
              <code className="truncate">{t.key}</code>
              {t.customized && <Pill tone="info">edited</Pill>}
            </button>
          ))}
        </nav>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Subject">
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
          <Field label="Body">
            <textarea
              className="h-72 w-full rounded-[10px] border border-line bg-surface p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>
          <p className="text-xs text-muted">
            Variables:{' '}
            {current.variables.map((v) => (
              <code key={v} className="mr-1.5">{`{{${v}}}`}</code>
            ))}
            <code>{'{{app}}'}</code>
          </p>
          <span className="flex items-center gap-3 text-[13px]">
            <Toggle
              checked={form.enabled}
              onChange={(v) => setForm({ ...form, enabled: v })}
              label="Send this email"
            />{' '}
            Send this email
          </span>
          <div className="flex justify-end gap-2">
            {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
            {current.customized && (
              <Button type="button" variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>
                Restore default
              </Button>
            )}
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
        <div className="overflow-hidden rounded-[12px] border border-line">
          <p className="border-b border-line bg-surface-2 px-3 py-2 text-xs">
            <span className="text-muted">Subject:</span> {preview.data?.subject}
          </p>
          <iframe
            title="Email preview"
            sandbox=""
            className="h-[420px] w-full bg-white"
            srcDoc={preview.data?.html ?? ''}
          />
        </div>
      </div>
    </Card>
  )
}

export function AdminMailPage() {
  return (
    <>
      <SmtpCard />
      <TemplatesCard />
    </>
  )
}
