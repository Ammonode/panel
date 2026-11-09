import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Lock, LockOpen, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, cn, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api, formatDate } from '../../lib/api'
import { formatBytes, serverCan } from '../../lib/server'
import { useServerContext } from './layout'

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

// ── Backups ────────────────────────────────────────────────
type Backup = {
  uuid: string
  name: string
  bytes: number
  isSuccessful: boolean
  isLocked: boolean
  checksum: string | null
  completedAt: string | null
  createdAt: string
}

export function BackupsPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const base = `/client/servers/${server.identifier}/backups`
  const { data } = useQuery({
    queryKey: ['backups', server.identifier],
    queryFn: () => api.get<{ data: Backup[]; limit: number }>(base),
    refetchInterval: (q) => (q.state.data?.data.some((b) => !b.completedAt) ? 3000 : false),
  })
  const [create, setCreate] = useState<{ name: string; ignored: string } | null>(null)
  const [restore, setRestore] = useState<Backup | null>(null)
  const [truncate, setTruncate] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['backups', server.identifier] })
  const start = useMutation({
    mutationFn: () => api.post(base, create),
    onSuccess: () => {
      setCreate(null)
      refresh()
    },
  })
  const lock = useMutation({
    mutationFn: (b: Backup) => api.post(`${base}/${b.uuid}/lock`),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (b: Backup) => api.delete(`${base}/${b.uuid}`),
    onSuccess: refresh,
  })
  const doRestore = useMutation({
    mutationFn: () => api.post(`${base}/${restore!.uuid}/restore`, { truncate }),
    onSuccess: () => {
      setRestore(null)
      qc.invalidateQueries({ queryKey: ['server'] })
    },
  })
  const download = async (b: Backup) => {
    const r = await api.get<{ data: { url: string } }>(`${base}/${b.uuid}/download`)
    window.location.href = r.data.url
  }
  const count = data?.data.length ?? 0
  const limit = data?.limit ?? server.featureLimits.backups
  return (
    <Card>
      <CardHeader
        title="Backups"
        subtitle={`${count} of ${limit} backups used. Locked backups cannot be deleted.`}
        action={
          serverCan(server, 'backup.create') && (
            <Button disabled={count >= limit} onClick={() => setCreate({ name: '', ignored: '' })}>
              <Plus className="size-4" /> Create backup
            </Button>
          )
        }
      />
      {(remove.error || lock.error) && (
        <p className="px-5 pb-3 text-[13px] text-danger">{(remove.error ?? lock.error)?.message}</p>
      )}
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((b) => (
          <div key={b.uuid} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <div className="min-w-48 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {b.name} {b.isLocked && <Lock className="size-3.5 text-muted" />}
              </p>
              <p className="text-xs text-muted">
                {formatDate(b.createdAt, true)}
                {b.checksum && ` · ${b.checksum.slice(0, 22)}…`}
              </p>
            </div>
            {!b.completedAt ? (
              <Pill tone="warn" dot>
                In progress
              </Pill>
            ) : b.isSuccessful ? (
              <span className="text-xs text-muted">{formatBytes(b.bytes)}</span>
            ) : (
              <Pill tone="danger">Failed</Pill>
            )}
            <div className="flex gap-1">
              {b.isSuccessful && serverCan(server, 'backup.download') && (
                <Button size="sm" variant="ghost" aria-label="Download" onClick={() => download(b)}>
                  <Download className="size-4" />
                </Button>
              )}
              {b.isSuccessful && serverCan(server, 'backup.restore') && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Restore"
                  onClick={() => {
                    setTruncate(false)
                    setRestore(b)
                  }}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              {serverCan(server, 'backup.delete') && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={b.isLocked ? 'Unlock' : 'Lock'}
                    onClick={() => lock.mutate(b)}
                  >
                    {b.isLocked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete"
                    disabled={b.isLocked || !b.completedAt}
                    onClick={() => remove.mutate(b)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {count === 0 && (
          <Empty title={limit ? 'No backups yet' : 'Backups are not available for this server'} />
        )}
      </div>
      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title="Create backup"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreate(null)}>
              Cancel
            </Button>
            <Button loading={start.isPending} onClick={() => start.mutate()}>
              Start backup
            </Button>
          </>
        }
      >
        {create && (
          <div className="space-y-3">
            <Field label="Name (optional)">
              <Input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            </Field>
            <Field label="Ignored files" hint="One pattern per line, like .gitignore (e.g. logs/ or *.log)">
              <textarea
                className="h-24 w-full rounded-[10px] border border-line bg-surface p-3 font-mono text-xs"
                value={create.ignored}
                onChange={(e) => setCreate({ ...create, ignored: e.target.value })}
              />
            </Field>
            {start.error && <p className="text-danger">{start.error.message}</p>}
          </div>
        )}
      </Modal>
      <Modal
        open={!!restore}
        onClose={() => setRestore(null)}
        title={`Restore "${restore?.name}"?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRestore(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={doRestore.isPending} onClick={() => doRestore.mutate()}>
              Restore
            </Button>
          </>
        }
      >
        <p>The server will be stopped while the backup is restored.</p>
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={truncate} onChange={(e) => setTruncate(e.target.checked)} /> Delete
          all current files first
        </label>
        {doRestore.error && <p className="mt-2 text-danger">{doRestore.error.message}</p>}
      </Modal>
    </Card>
  )
}

// ── Schedules ──────────────────────────────────────────────
type Task = {
  id: number
  sequence: number
  action: string
  payload: string
  timeOffset: number
  continueOnFailure: boolean
}
type Schedule = {
  id: number
  name: string
  cronMinute: string
  cronHour: string
  cronDayOfMonth: string
  cronMonth: string
  cronDayOfWeek: string
  isActive: boolean
  isProcessing: boolean
  onlyWhenOnline: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  tasks: Task[]
}
const cronPresets = [
  { label: 'Every hour', value: ['0', '*', '*', '*', '*'] },
  { label: 'Every day at 04:00', value: ['0', '4', '*', '*', '*'] },
  { label: 'Every 6 hours', value: ['0', '*/6', '*', '*', '*'] },
  { label: 'Every Sunday at 03:00', value: ['0', '3', '*', '*', '0'] },
]

function TaskForm({ schedule, onDone }: { schedule: Schedule; onDone: () => void }) {
  const { server } = useServerContext()
  const [task, setTask] = useState({
    action: 'command',
    payload: '',
    timeOffset: 0,
    continueOnFailure: false,
  })
  const add = useMutation({
    mutationFn: () => api.post(`/client/servers/${server.identifier}/schedules/${schedule.id}/tasks`, task),
    onSuccess: () => {
      setTask((t) => ({ ...t, payload: t.action === 'power' ? t.payload : '', timeOffset: 0 }))
      onDone()
    },
  })
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[12px] bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate()
      }}
    >
      <Field label="Action">
        <select
          className={`${selectClass} w-36`}
          value={task.action}
          onChange={(e) =>
            setTask({ ...task, action: e.target.value, payload: e.target.value === 'power' ? 'restart' : '' })
          }
        >
          <option value="command">Send command</option>
          <option value="power">Power action</option>
          <option value="backup">Create backup</option>
        </select>
      </Field>
      {task.action === 'power' ? (
        <Field label="Signal">
          <select
            className={`${selectClass} w-32`}
            value={task.payload}
            onChange={(e) => setTask({ ...task, payload: e.target.value })}
          >
            {['start', 'stop', 'restart', 'kill'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label={task.action === 'backup' ? 'Ignored files' : 'Command'}>
          <Input
            className="w-64"
            value={task.payload}
            onChange={(e) => setTask({ ...task, payload: e.target.value })}
          />
        </Field>
      )}
      <Field label="Delay (s)">
        <Input
          type="number"
          min={0}
          max={900}
          className="w-20"
          value={task.timeOffset}
          onChange={(e) => setTask({ ...task, timeOffset: Number(e.target.value) })}
        />
      </Field>
      <label className="flex h-10 items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={task.continueOnFailure}
          onChange={(e) => setTask({ ...task, continueOnFailure: e.target.checked })}
        />{' '}
        Continue on failure
      </label>
      <Button type="submit" size="sm" loading={add.isPending}>
        Add task
      </Button>
      {add.error && <p className="w-full text-xs text-danger">{add.error.message}</p>}
    </form>
  )
}

export function SchedulesPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const base = `/client/servers/${server.identifier}/schedules`
  const { data } = useQuery({
    queryKey: ['schedules', server.identifier],
    queryFn: () => api.get<{ data: Schedule[] }>(base),
    refetchInterval: 15000,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['schedules', server.identifier] })
  const [edit, setEdit] = useState<
    (Omit<Schedule, 'tasks' | 'isProcessing' | 'lastRunAt' | 'nextRunAt' | 'id'> & { id?: number }) | null
  >(null)
  const save = useMutation({
    mutationFn: () => (edit!.id ? api.put(`${base}/${edit!.id}`, edit) : api.post(base, edit)),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const run = useMutation({
    mutationFn: (id: number) => api.post(`${base}/${id}/execute`),
    onSuccess: () => setTimeout(refresh, 1500),
  })
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/${id}`), onSuccess: refresh })
  const removeTask = useMutation({
    mutationFn: ({ s, t }: { s: number; t: number }) => api.delete(`${base}/${s}/tasks/${t}`),
    onSuccess: refresh,
  })
  const cron = (
    s: Pick<Schedule, 'cronMinute' | 'cronHour' | 'cronDayOfMonth' | 'cronMonth' | 'cronDayOfWeek'>,
  ) => `${s.cronMinute} ${s.cronHour} ${s.cronDayOfMonth} ${s.cronMonth} ${s.cronDayOfWeek}`
  const blank = {
    name: '',
    cronMinute: '0',
    cronHour: '4',
    cronDayOfMonth: '*',
    cronMonth: '*',
    cronDayOfWeek: '*',
    isActive: true,
    onlyWhenOnline: false,
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Schedules"
          subtitle="Run commands, restarts or backups automatically. Times are in UTC."
          action={
            serverCan(server, 'schedule.create') && (
              <Button onClick={() => setEdit(blank)}>
                <Plus className="size-4" /> New schedule
              </Button>
            )
          }
        />
        {data?.data.length === 0 && <Empty title="No schedules yet" />}
      </Card>
      {data?.data.map((s) => (
        <Card key={s.id}>
          <div className="flex flex-wrap items-center gap-3 p-5">
            <div className="min-w-48 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {s.name} {!s.isActive && <Pill>Inactive</Pill>}{' '}
                {s.isProcessing && (
                  <Pill tone="warn" dot>
                    Running
                  </Pill>
                )}
              </p>
              <p className="text-xs text-muted">
                <code>{cron(s)}</code> · last {s.lastRunAt ? formatDate(s.lastRunAt, true) : 'never'} · next{' '}
                {s.nextRunAt && s.isActive ? formatDate(s.nextRunAt, true) : '—'}
                {s.onlyWhenOnline && ' · only when online'}
              </p>
            </div>
            {serverCan(server, 'schedule.update') && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!s.tasks.length || s.isProcessing}
                  loading={run.isPending && run.variables === s.id}
                  onClick={() => run.mutate(s.id)}
                >
                  <Play className="size-3.5" /> Run now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEdit({
                      id: s.id,
                      name: s.name,
                      cronMinute: s.cronMinute,
                      cronHour: s.cronHour,
                      cronDayOfMonth: s.cronDayOfMonth,
                      cronMonth: s.cronMonth,
                      cronDayOfWeek: s.cronDayOfWeek,
                      isActive: s.isActive,
                      onlyWhenOnline: s.onlyWhenOnline,
                    })
                  }
                >
                  Edit
                </Button>
              </>
            )}
            {serverCan(server, 'schedule.delete') && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete schedule"
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
          <div className="space-y-2 border-t border-line p-5">
            {s.tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-[13px]">
                <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-xs">
                  {t.sequence}
                </span>
                <span className="flex-1">
                  {t.action === 'command' ? (
                    <>
                      Send <code className="rounded bg-surface-2 px-1">{t.payload}</code>
                    </>
                  ) : t.action === 'power' ? (
                    <>Power: {t.payload}</>
                  ) : (
                    'Create backup'
                  )}
                  {t.timeOffset > 0 && <span className="text-xs text-muted"> after {t.timeOffset}s</span>}
                  {t.continueOnFailure && <span className="text-xs text-muted"> · continues on failure</span>}
                </span>
                {serverCan(server, 'schedule.update') && (
                  <button
                    type="button"
                    aria-label="Remove task"
                    className="text-muted hover:text-danger"
                    onClick={() => removeTask.mutate({ s: s.id, t: t.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
            {serverCan(server, 'schedule.update') && s.tasks.length < 10 && (
              <TaskForm schedule={s} onDone={refresh} />
            )}
          </div>
        </Card>
      ))}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit schedule' : 'New schedule'}
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
          <div className="space-y-3">
            <Field label="Name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {cronPresets.map((p) => (
                <button
                  type="button"
                  key={p.label}
                  className={cn(
                    'rounded-lg border border-line px-2 py-1 text-xs',
                    cron(edit) === p.value.join(' ') && 'border-primary',
                  )}
                  onClick={() =>
                    setEdit({
                      ...edit,
                      cronMinute: p.value[0]!,
                      cronHour: p.value[1]!,
                      cronDayOfMonth: p.value[2]!,
                      cronMonth: p.value[3]!,
                      cronDayOfWeek: p.value[4]!,
                    })
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(['cronMinute', 'cronHour', 'cronDayOfMonth', 'cronMonth', 'cronDayOfWeek'] as const).map(
                (k, i) => (
                  <Field key={k} label={['Minute', 'Hour', 'Day', 'Month', 'Weekday'][i]!}>
                    <Input value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                  </Field>
                ),
              )}
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={edit.isActive}
                onChange={(v) => setEdit({ ...edit, isActive: v })}
                label="Active"
              />{' '}
              Active
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={edit.onlyWhenOnline}
                onChange={(v) => setEdit({ ...edit, onlyWhenOnline: v })}
                label="Only when online"
              />{' '}
              Only run when the server is online
            </div>
            {save.error && <p className="text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}

// ── Users ──────────────────────────────────────────────────
type Subuser = {
  uuid: string
  email: string
  username: string
  twoFactorEnabled: boolean
  permissions: string[]
}

function PermissionPicker({
  available,
  value,
  onChange,
}: {
  available: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const groups = [...new Set(available.map((p) => p.split('.')[0]!))]
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
      {groups.map((g) => {
        const perms = available.filter((p) => p.startsWith(`${g}.`))
        const all = perms.every((p) => value.includes(p))
        return (
          <div key={g}>
            <label className="flex items-center gap-2 text-[13px] font-medium capitalize">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...new Set([...value, ...perms])]
                      : value.filter((p) => !perms.includes(p)),
                  )
                }
              />{' '}
              {g}
            </label>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-6">
              {perms.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={value.includes(p)}
                    onChange={(e) =>
                      onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))
                    }
                  />{' '}
                  {p.split('.').slice(1).join('.')}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function UsersPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const base = `/client/servers/${server.identifier}/users`
  const { data } = useQuery({
    queryKey: ['subusers', server.identifier],
    queryFn: () => api.get<{ data: Subuser[]; available: string[] }>(base),
  })
  const [edit, setEdit] = useState<{ uuid?: string; email: string; permissions: string[] } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['subusers', server.identifier] })
  const save = useMutation({
    mutationFn: () =>
      edit!.uuid
        ? api.put(`${base}/${edit!.uuid}`, { permissions: edit!.permissions })
        : api.post(base, edit),
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (uuid: string) => api.delete(`${base}/${uuid}`),
    onSuccess: refresh,
  })
  // You can only hand out permissions you hold yourself.
  const grantable = (data?.available ?? []).filter((p) => serverCan(server, p))
  return (
    <Card>
      <CardHeader
        title="Users"
        subtitle="Give friends or staff access to this server."
        action={
          serverCan(server, 'user.create') && (
            <Button
              onClick={() =>
                setEdit({
                  email: '',
                  permissions: ['control.console', 'control.start', 'control.stop', 'control.restart'],
                })
              }
            >
              <Plus className="size-4" /> Add user
            </Button>
          )
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((u) => (
          <div key={u.uuid} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{u.username}</p>
              <p className="text-xs text-muted">{u.email}</p>
            </div>
            {!u.twoFactorEnabled && <Pill tone="warn">No 2FA</Pill>}
            <span className="text-xs text-muted">{u.permissions.length} permissions</span>
            {serverCan(server, 'user.update') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEdit({ uuid: u.uuid, email: u.email, permissions: u.permissions })}
              >
                Edit
              </Button>
            )}
            {serverCan(server, 'user.delete') && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${u.email}`}
                onClick={() => remove.mutate(u.uuid)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="Only you have access to this server" />}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.uuid ? `Permissions for ${edit.email}` : 'Add user'}
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
            {!edit.uuid && (
              <Field label="Email of their account">
                <Input
                  type="email"
                  value={edit.email}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                />
              </Field>
            )}
            <PermissionPicker
              available={grantable}
              value={edit.permissions}
              onChange={(permissions) => setEdit({ ...edit, permissions })}
            />
            {save.error && <p className="text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

// ── Activity ───────────────────────────────────────────────
type Activity = {
  id: number
  event: string
  ip: string | null
  properties: Record<string, unknown>
  createdAt: string
  actor: { username: string } | null
}

export function ActivityPage() {
  const { server } = useServerContext()
  const { data } = useQuery({
    queryKey: ['activity', server.identifier],
    queryFn: () => api.get<{ data: Activity[] }>(`/client/servers/${server.identifier}/activity`),
  })
  const describe = (p: Record<string, unknown>) =>
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ')
  return (
    <Card>
      <CardHeader title="Activity" />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
            <code className="min-w-52 text-xs">{a.event.replace(/^server:/, '')}</code>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{describe(a.properties)}</span>
            <span className="text-xs text-muted">
              {a.actor?.username ?? 'System'}
              {a.ip ? ` · ${a.ip}` : ''}
            </span>
            <span className="w-36 text-right text-xs text-muted">{formatDate(a.createdAt, true)}</span>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No activity yet" />}
      </div>
    </Card>
  )
}

// ── Databases ──────────────────────────────────────────────
type ServerDatabase = {
  id: number
  name: string
  username: string
  remote: string
  host: { address: string; port: number } | null
  password?: string
}

export function DatabasesPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const base = `/client/servers/${server.identifier}/databases`
  const { data } = useQuery({
    queryKey: ['databases', server.identifier],
    queryFn: () => api.get<{ data: ServerDatabase[]; limit: number }>(base),
  })
  const [form, setForm] = useState<{ name: string; remote: string } | null>(null)
  const [shown, setShown] = useState<number | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['databases', server.identifier] })
  const create = useMutation({
    mutationFn: () => api.post(base, form),
    onSuccess: () => {
      setForm(null)
      refresh()
    },
  })
  const rotate = useMutation({
    mutationFn: (id: number) => api.post(`${base}/${id}/rotate-password`),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/${id}`), onSuccess: refresh })
  const count = data?.data.length ?? 0
  const limit = data?.limit ?? server.featureLimits.databases
  return (
    <Card>
      <CardHeader
        title="Databases"
        subtitle={`${count} of ${limit} databases used.`}
        action={
          serverCan(server, 'database.create') && (
            <Button disabled={count >= limit} onClick={() => setForm({ name: '', remote: '%' })}>
              <Plus className="size-4" /> New database
            </Button>
          )
        }
      />
      {(rotate.error || remove.error) && (
        <p className="px-5 pb-3 text-[13px] text-danger">{(rotate.error ?? remove.error)?.message}</p>
      )}
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((d) => (
          <div
            key={d.id}
            className="grid gap-3 px-5 py-4 text-[13px] md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-center"
          >
            <div>
              <p className="font-medium">{d.name}</p>
              <p className="text-xs text-muted">{d.host ? `${d.host.address}:${d.host.port}` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Username</p>
              <code>{d.username}</code>
            </div>
            <div>
              <p className="text-xs text-muted">Password</p>
              {d.password ? (
                <button
                  type="button"
                  className="font-mono"
                  onClick={() => setShown(shown === d.id ? null : d.id)}
                >
                  {shown === d.id ? d.password : '••••••••••'}
                </button>
              ) : (
                <span className="text-muted">Hidden</span>
              )}
            </div>
            <div className="flex gap-1">
              {serverCan(server, 'database.update') && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={rotate.isPending && rotate.variables === d.id}
                  onClick={() => rotate.mutate(d.id)}
                >
                  Rotate password
                </Button>
              )}
              {serverCan(server, 'database.delete') && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => remove.mutate(d.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {count === 0 && (
          <Empty title={limit ? 'No databases yet' : 'Databases are not available for this server'} />
        )}
      </div>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="New database"
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
          <div className="space-y-3">
            <Field label="Name" hint={`Created as s${server.id}_${form.name || 'name'}`}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Connections from" hint="% allows any address">
              <Input value={form.remote} onChange={(e) => setForm({ ...form, remote: e.target.value })} />
            </Field>
            {create.error && <p className="text-danger">{create.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}
