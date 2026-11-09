import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Paperclip, Plus } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Button, Card, CardHeader, cn, Empty, Field, Input, Pill } from '../components/ui'
import { ApiError, api, formatDate } from '../lib/api'

export type TicketMessage = {
  id: number
  message: string
  createdAt: string
  attachments: { index: number; name: string; size: number }[]
  author: { id: number; name: string; staff: boolean }
}
type Ticket = {
  id: number
  subject: string
  status: string
  priority: string
  updatedAt: string
  createdAt: string
  department?: string | null
  messages?: TicketMessage[]
}

export const ticketTone = { open: 'warn', replied: 'warn', answered: 'info', closed: 'neutral' } as const
export const priorityTone = { low: 'neutral', medium: 'info', high: 'danger' } as const
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

/** Sends JSON, or multipart when files are attached. */
export async function postMessage(path: string, fields: Record<string, string>, files: File[]) {
  if (!files.length) return api.post(path, fields)
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  for (const f of files) form.append('files[]', f)
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin' })
  const data = await res.json().catch(() => null)
  if (!res.ok)
    throw new ApiError(res.status, data?.error?.message ?? res.statusText, data?.error?.code ?? 'error')
  return data
}

export function AttachInput({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button type="button" size="sm" variant="ghost" onClick={() => input.current?.click()}>
        <Paperclip className="size-3.5" /> Attach files
      </Button>
      {files.map((f) => (
        <span key={f.name} className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1">
          {f.name}
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            className="text-muted hover:text-danger"
            onClick={() => onChange(files.filter((x) => x !== f))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.json,.yml,.yaml,.properties,.zip,.gz"
        onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, 5))}
      />
    </div>
  )
}

export function Thread({
  messages,
  base,
  viewerIsStaff,
}: {
  messages: TicketMessage[]
  base: string
  viewerIsStaff?: boolean
}) {
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const mine = viewerIsStaff ? m.author.staff : !m.author.staff
        return (
          <div
            key={m.id}
            className={cn(
              'rounded-[12px] border p-4',
              m.author.staff ? 'border-line bg-info-bg/40' : 'border-line bg-surface',
            )}
          >
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">
                {m.author.name} {m.author.staff && <Pill tone="info">Staff</Pill>}{' '}
                {mine && <span className="text-muted">(you)</span>}
              </span>
              <span className="text-muted">{formatDate(m.createdAt, true)}</span>
            </div>
            {/* Plain text only: messages are never rendered as HTML. */}
            <p className="text-[13.5px] whitespace-pre-wrap break-words">{m.message}</p>
            {m.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <a
                    key={a.index}
                    href={`/api${base}/messages/${m.id}/attachments/${a.index}`}
                    className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-2"
                  >
                    <Paperclip className="size-3" /> {a.name}{' '}
                    <span className="text-muted">({Math.ceil(a.size / 1024)} KB)</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function TicketsPage() {
  const { data } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => api.get<{ data: Ticket[] }>('/client/tickets'),
  })
  return (
    <Card>
      <CardHeader
        title="Support"
        subtitle="Our team usually replies within a few hours."
        action={
          <Link
            to="/tickets/new"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            <Plus className="size-4" /> New ticket
          </Link>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((t) => (
          <Link
            key={t.id}
            to="/tickets/$id"
            params={{ id: String(t.id) }}
            className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-surface-2"
          >
            <span className="w-10 text-xs text-muted">#{t.id}</span>
            <span className="min-w-48 flex-1 font-medium">{t.subject}</span>
            <span className="text-xs text-muted">Updated {formatDate(t.updatedAt, true)}</span>
            <Pill
              tone={ticketTone[t.status as keyof typeof ticketTone] ?? 'neutral'}
              dot={t.status !== 'closed'}
            >
              {t.status === 'replied' ? 'Awaiting reply' : cap(t.status)}
            </Pill>
          </Link>
        ))}
        {data?.data.length === 0 && <Empty title="No tickets yet" />}
      </div>
    </Card>
  )
}

export function NewTicketPage() {
  const navigate = useNavigate()
  const departments = useQuery({
    queryKey: ['ticket-departments'],
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/client/tickets/departments'),
  })
  const services = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<{ data: { id: number; product: string; status: string }[] }>('/client/services'),
  })
  const [form, setForm] = useState({
    subject: '',
    departmentId: '',
    priority: 'medium',
    serviceId: '',
    message: '',
  })
  const [files, setFiles] = useState<File[]>([])
  const create = useMutation({
    mutationFn: () => {
      const fields: Record<string, string> = {
        subject: form.subject,
        priority: form.priority,
        message: form.message,
      }
      if (form.departmentId) fields.departmentId = form.departmentId
      if (form.serviceId) fields.serviceId = form.serviceId
      return postMessage('/client/tickets', fields, files) as Promise<{ data: { id: number } }>
    },
    onSuccess: (r) => navigate({ to: '/tickets/$id', params: { id: String(r.data.id) } }),
  })
  return (
    <Card>
      <CardHeader title="New ticket" />
      <form
        className="grid gap-4 px-5 pb-5 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div className="md:col-span-3">
          <Field label="Subject">
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
        </div>
        <Field label="Department">
          <select
            className={selectClass}
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          >
            <option value="">General</option>
            {departments.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            className={selectClass}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Related service">
          <select
            className={selectClass}
            value={form.serviceId}
            onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
          >
            <option value="">None</option>
            {services.data?.data
              .filter((s) => s.status !== 'cancelled')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} {s.product}
                </option>
              ))}
          </select>
        </Field>
        <div className="md:col-span-3">
          <Field label="Message">
            <textarea
              className="min-h-40 w-full rounded-[10px] border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-3">
          <AttachInput files={files} onChange={setFiles} />
          <div className="flex items-center gap-3">
            {create.error && <span className="text-[13px] text-danger">{create.error.message}</span>}
            <Button type="submit" loading={create.isPending}>
              Open ticket
            </Button>
          </div>
        </div>
      </form>
    </Card>
  )
}

export function ReplyBox({
  onSend,
  extra,
  disabledReason,
}: {
  onSend: (message: string, files: File[], close?: boolean) => Promise<unknown>
  extra?: ReactNode
  disabledReason?: string
}) {
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const send = useMutation({
    mutationFn: (close?: boolean) => onSend(message, files, close),
    onSuccess: () => {
      setMessage('')
      setFiles([])
    },
  })
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        send.mutate(false)
      }}
    >
      <textarea
        className="min-h-32 w-full rounded-[10px] border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
        placeholder={disabledReason ?? 'Write a reply…'}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Reply"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AttachInput files={files} onChange={setFiles} />
        <div className="flex items-center gap-2">
          {send.error && <span className="text-[13px] text-danger">{send.error.message}</span>}
          {extra && (
            <Button
              type="button"
              variant="outline"
              loading={send.isPending && send.variables === true}
              disabled={!message.trim()}
              onClick={() => send.mutate(true)}
            >
              {extra}
            </Button>
          )}
          <Button type="submit" loading={send.isPending && !send.variables} disabled={!message.trim()}>
            Send reply
          </Button>
        </div>
      </div>
    </form>
  )
}

export function TicketPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<{ data: Ticket }>(`/client/tickets/${id}`).then((r) => r.data),
    refetchInterval: 30_000,
  })
  const close = useMutation({
    mutationFn: () => api.post(`/client/tickets/${id}/close`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', id] }),
  })
  if (error)
    return (
      <Card>
        <Empty title="Ticket not found" />
      </Card>
    )
  if (!data) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="text-xl font-medium">{data.subject}</h2>
              <p className="text-[13px] text-muted">
                #{data.id} · {data.department ?? 'General'} · opened {formatDate(data.createdAt)}
              </p>
            </div>
            <Pill tone={ticketTone[data.status as keyof typeof ticketTone] ?? 'neutral'}>
              {data.status === 'replied' ? 'Awaiting reply' : cap(data.status)}
            </Pill>
          </div>
        </Card>
        <Thread messages={data.messages ?? []} base={`/client/tickets/${id}`} />
        <Card className="p-5">
          <ReplyBox
            disabledReason={
              data.status === 'closed' ? 'This ticket is closed. Replying reopens it.' : undefined
            }
            onSend={async (message, files) => {
              await postMessage(`/client/tickets/${id}/reply`, { message }, files)
              await qc.invalidateQueries({ queryKey: ['ticket', id] })
            }}
          />
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader title="Details" />
        <dl className="space-y-2 px-5 pb-5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-muted">Priority</dt>
            <dd>
              <Pill tone={priorityTone[data.priority as keyof typeof priorityTone] ?? 'neutral'}>
                {cap(data.priority)}
              </Pill>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Last update</dt>
            <dd>{formatDate(data.updatedAt, true)}</dd>
          </div>
          {data.status !== 'closed' && (
            <Button
              className="mt-3 w-full"
              variant="outline"
              loading={close.isPending}
              onClick={() => close.mutate()}
            >
              Close ticket
            </Button>
          )}
        </dl>
      </Card>
    </div>
  )
}
