import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ExternalLink, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, CardHeader, cn, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api, formatDate } from '../../lib/api'

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

type ServerRow = {
  id: number
  uuidShort: string
  name: string
  status: string | null
  memory: number
  disk: number
  cpu: number
  owner: { email: string }
  nodeName: string
  eggName: string
}
type Allocation = { id: number; ip: string; ipAlias: string | null; port: number; serverId: number | null }
type Nest = { id: number; name: string; eggs: { id: number; name: string }[] }
type EggDetail = {
  id: number
  name: string
  startup: string
  dockerImages: Record<string, string>
  variables: { envVariable: string; name: string; description: string; defaultValue: string; rules: string }[]
}
type ServerDetail = {
  id: number
  uuid: string
  uuidShort: string
  name: string
  description: string | null
  externalId: string | null
  status: string | null
  memory: number
  swap: number
  disk: number
  io: number
  cpu: number
  threads: string | null
  oomDisabled: boolean
  databaseLimit: number
  allocationLimit: number
  backupLimit: number
  allocationId: number
  startup: string
  image: string
  skipScripts: boolean
  eggId: number
  owner: { id: number; email: string; username: string }
  node: { id: number; name: string }
  egg: { id: number; name: string; dockerImages: Record<string, string>; startup: string }
  allocations: Allocation[]
  variables: { envVariable: string; name: string; description: string; rules: string; value: string }[]
}

export function AdminServersPage() {
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useQuery({
    queryKey: ['admin', 'servers', search],
    queryFn: () => api.get<{ data: ServerRow[] }>(`/admin/servers?q=${encodeURIComponent(search)}`),
    placeholderData: (p) => p,
  })
  return (
    <Card>
      <CardHeader
        title="Servers"
        action={
          <Link
            to="/admin/servers/$id"
            params={{ id: 'new' }}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            <Plus className="size-4" /> New server
          </Link>
        }
      />
      <div className="px-5 pb-4">
        <Input
          icon={<Search className="size-4" />}
          placeholder="Search by name, id or owner email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((s) => (
          <Link
            key={s.id}
            to="/admin/servers/$id"
            params={{ id: String(s.id) }}
            className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-surface-2"
          >
            <code className="w-20 text-xs text-muted">{s.uuidShort}</code>
            <span className="min-w-48 flex-1">
              <span className="font-medium">{s.name}</span>
              <span className="block text-xs text-muted">{s.owner.email}</span>
            </span>
            <span className="text-xs text-muted">
              {s.eggName} · {s.nodeName}
            </span>
            <span className="w-40 text-right text-xs text-muted">
              {s.memory} MiB · {Math.round(s.disk / 1024)} GiB · {s.cpu || '∞'}%
            </span>
            {s.status && <Pill tone={s.status === 'suspended' ? 'danger' : 'warn'}>{s.status}</Pill>}
          </Link>
        ))}
        {data?.data.length === 0 && <Empty title="No servers found" />}
      </div>
    </Card>
  )
}

/** Debounced user lookup for picking an owner. */
function OwnerPicker({
  value,
  onChange,
}: {
  value: { id: number; email: string } | null
  onChange: (u: { id: number; email: string }) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['admin', 'user-search', q],
    enabled: open && q.length > 1,
    queryFn: () =>
      api.get<{ data: { id: number; email: string; username: string }[] }>(
        `/admin/users?q=${encodeURIComponent(q)}`,
      ),
  })
  return (
    <div className="relative">
      <Input
        value={open ? q : (value?.email ?? '')}
        placeholder="Search users by email"
        onFocus={() => {
          setOpen(true)
          setQ('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && !!data?.data.length && (
        <div className="absolute z-10 mt-1 w-full rounded-[10px] border border-line bg-surface p-1 shadow-lg">
          {data.data.slice(0, 8).map((u) => (
            <button
              type="button"
              key={u.id}
              className="block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"
              onMouseDown={() => onChange(u)}
            >
              {u.email} <span className="text-xs text-muted">{u.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Limits({
  v,
  set,
}: {
  v: Record<string, number | string | boolean>
  set: (k: string, val: number | string | boolean) => void
}) {
  const num = (k: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" value={String(v[k] ?? '')} onChange={(e) => set(k, Number(e.target.value))} />
    </Field>
  )
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {num('memory', 'Memory (MiB)', '0 = unlimited')}
      {num('swap', 'Swap (MiB)', '-1 = unlimited')}
      {num('disk', 'Disk (MiB)', '0 = unlimited')}
      {num('cpu', 'CPU (%)', '100 = one core, 0 = unlimited')}
      {num('io', 'Block IO weight', '10 - 1000')}
      <Field label="CPU pinning" hint="e.g. 0,1 or 0-3; empty = any">
        <Input value={String(v.threads ?? '')} onChange={(e) => set('threads', e.target.value)} />
      </Field>
      {num('databaseLimit', 'Databases')}
      {num('backupLimit', 'Backups')}
      {num('allocationLimit', 'Extra ports')}
    </div>
  )
}

function NewServer() {
  const navigate = useNavigate()
  const nodes = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/admin/nodes'),
  })
  const nests = useQuery({
    queryKey: ['admin', 'nests'],
    queryFn: () => api.get<{ data: Nest[] }>('/admin/nests'),
  })
  const [owner, setOwner] = useState<{ id: number; email: string } | null>(null)
  const [nodeId, setNodeId] = useState(0)
  const [eggId, setEggId] = useState(0)
  const [form, setForm] = useState<Record<string, number | string | boolean>>({
    name: '',
    memory: 1024,
    swap: 0,
    disk: 5120,
    cpu: 100,
    io: 500,
    threads: '',
    databaseLimit: 0,
    backupLimit: 1,
    allocationLimit: 0,
    allocationId: 0,
    image: '',
    startup: '',
    startOnCompletion: true,
  })
  const [env, setEnv] = useState<Record<string, string>>({})
  const node = nodeId || nodes.data?.data[0]?.id || 0
  const allocations = useQuery({
    queryKey: ['admin', 'allocations', node],
    enabled: !!node,
    queryFn: () => api.get<{ data: Allocation[] }>(`/admin/nodes/${node}/allocations`),
  })
  const free = useMemo(() => allocations.data?.data.filter((a) => !a.serverId) ?? [], [allocations.data])
  const egg = useQuery({
    queryKey: ['admin', 'egg', eggId],
    enabled: !!eggId,
    queryFn: () => api.get<{ data: EggDetail }>(`/admin/eggs/${eggId}`).then((r) => r.data),
  })
  useEffect(() => {
    if (!eggId && nests.data) setEggId(nests.data.data.find((n) => n.eggs.length)?.eggs[0]?.id ?? 0)
  }, [nests.data, eggId])
  useEffect(() => {
    if (!egg.data) return
    setEnv(Object.fromEntries(egg.data.variables.map((v) => [v.envVariable, v.defaultValue])))
    setForm((f) => ({
      ...f,
      image: Object.values(egg.data.dockerImages)[0] ?? '',
      startup: egg.data.startup,
    }))
  }, [egg.data])
  const set = (k: string, v: number | string | boolean) => setForm((f) => ({ ...f, [k]: v }))
  const create = useMutation({
    mutationFn: () =>
      api.post<{ data: { id: number } }>('/admin/servers', {
        name: form.name,
        ownerId: owner?.id,
        nodeId: node,
        eggId,
        allocationId: Number(form.allocationId) || free[0]?.id,
        memory: form.memory,
        swap: form.swap,
        disk: form.disk,
        cpu: form.cpu,
        io: form.io,
        threads: form.threads || null,
        databaseLimit: form.databaseLimit,
        backupLimit: form.backupLimit,
        allocationLimit: form.allocationLimit,
        image: form.image,
        startup: form.startup,
        environment: env,
        startOnCompletion: form.startOnCompletion,
      }),
    onSuccess: ({ data }) => navigate({ to: '/admin/servers/$id', params: { id: String(data.id) } }),
  })
  const err = create.error as (Error & { details?: Record<string, string> }) | null
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <Card>
        <CardHeader title="New server" />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Name">
            <Input value={String(form.name)} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Owner">
            <OwnerPicker value={owner} onChange={setOwner} />
          </Field>
          <Field label="Node">
            <select
              className={selectClass}
              value={node}
              onChange={(e) => {
                setNodeId(Number(e.target.value))
                set('allocationId', 0)
              }}
            >
              {nodes.data?.data.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Primary port"
            hint={
              free.length
                ? `${free.length} free on this node`
                : 'No free ports, add allocations to the node first'
            }
          >
            <select
              className={selectClass}
              value={String(form.allocationId || free[0]?.id || '')}
              onChange={(e) => set('allocationId', Number(e.target.value))}
            >
              {free.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ipAlias ?? a.ip}:{a.port}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Resources" />
        <div className="px-5 pb-5">
          <Limits v={form} set={set} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Egg & startup" />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Egg">
            <select className={selectClass} value={eggId} onChange={(e) => setEggId(Number(e.target.value))}>
              {nests.data?.data.map((n) => (
                <optgroup key={n.id} label={n.name}>
                  {n.eggs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Docker image">
            <select
              className={selectClass}
              value={String(form.image)}
              onChange={(e) => set('image', e.target.value)}
            >
              {Object.entries(egg.data?.dockerImages ?? {}).map(([label, img]) => (
                <option key={img} value={img}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Startup command">
              <Input value={String(form.startup)} onChange={(e) => set('startup', e.target.value)} />
            </Field>
          </div>
          {egg.data?.variables.map((v) => (
            <Field
              key={v.envVariable}
              label={v.name}
              hint={err?.details?.[`environment.${v.envVariable}`] ?? `${v.envVariable} · ${v.rules}`}
            >
              <Input
                value={env[v.envVariable] ?? ''}
                onChange={(e) => setEnv({ ...env, [v.envVariable]: e.target.value })}
              />
            </Field>
          ))}
          <span className="flex items-center gap-3 text-[13px] md:col-span-2">
            <Toggle
              checked={!!form.startOnCompletion}
              onChange={(v) => set('startOnCompletion', v)}
              label="Start after install"
            />{' '}
            Start the server when the install finishes
          </span>
        </div>
      </Card>
      {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={create.isPending} disabled={!owner || !free.length || !eggId}>
          Create server
        </Button>
      </div>
    </form>
  )
}

function SaveRow({ m }: { m: { isPending: boolean; isSuccess: boolean; error: Error | null } }) {
  return (
    <div className="flex items-center justify-end gap-3">
      {m.error && <span className="text-[13px] text-danger">{m.error.message}</span>}
      {m.isSuccess && <span className="text-[13px] text-success">Saved</span>}
      <Button type="submit" loading={m.isPending}>
        Save
      </Button>
    </div>
  )
}

function EditServer({ id }: { id: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'details' | 'build' | 'startup' | 'manage'>('details')
  const { data: s, error } = useQuery({
    queryKey: ['admin', 'server', id],
    queryFn: () => api.get<{ data: ServerDetail }>(`/admin/servers/${id}`).then((r) => r.data),
  })
  const nests = useQuery({
    queryKey: ['admin', 'nests'],
    queryFn: () => api.get<{ data: Nest[] }>('/admin/nests'),
  })
  const allocations = useQuery({
    queryKey: ['admin', 'allocations', s?.node.id],
    enabled: !!s,
    queryFn: () => api.get<{ data: Allocation[] }>(`/admin/nodes/${s!.node.id}/allocations`),
  })
  const [details, setDetails] = useState({ name: '', description: '', externalId: '' })
  const [owner, setOwner] = useState<{ id: number; email: string } | null>(null)
  const [build, setBuild] = useState<Record<string, number | string | boolean>>({})
  const [startup, setStartup] = useState({ startup: '', image: '', eggId: 0, skipScripts: false })
  const [env, setEnv] = useState<Record<string, string>>({})
  const [addPort, setAddPort] = useState('')
  const [confirm, setConfirm] = useState<null | 'delete' | 'reinstall'>(null)
  const [force, setForce] = useState(false)

  useEffect(() => {
    if (!s) return
    setDetails({ name: s.name, description: s.description ?? '', externalId: s.externalId ?? '' })
    setOwner(s.owner)
    setBuild({
      memory: s.memory,
      swap: s.swap,
      disk: s.disk,
      io: s.io,
      cpu: s.cpu,
      threads: s.threads ?? '',
      databaseLimit: s.databaseLimit,
      backupLimit: s.backupLimit,
      allocationLimit: s.allocationLimit,
    })
    setStartup({ startup: s.startup, image: s.image, eggId: s.eggId, skipScripts: s.skipScripts })
    setEnv(Object.fromEntries(s.variables.map((v) => [v.envVariable, v.value])))
  }, [s])
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'server', id] })
  const saveDetails = useMutation({
    mutationFn: () =>
      api.patch(`/admin/servers/${id}/details`, {
        ...details,
        description: details.description || null,
        externalId: details.externalId || null,
        ownerId: owner?.id,
      }),
    onSuccess: refresh,
  })
  const saveBuild = useMutation({
    mutationFn: () => api.patch(`/admin/servers/${id}/build`, { ...build, threads: build.threads || null }),
    onSuccess: refresh,
  })
  const ports = useMutation({
    mutationFn: (body: { addAllocations?: number[]; removeAllocations?: number[]; allocationId?: number }) =>
      api.patch(`/admin/servers/${id}/build`, body),
    onSuccess: () => {
      setAddPort('')
      refresh()
      qc.invalidateQueries({ queryKey: ['admin', 'allocations'] })
    },
  })
  const changedEgg = startup.eggId !== s?.eggId
  const saveStartup = useMutation({
    mutationFn: () =>
      api.patch(
        `/admin/servers/${id}/startup`,
        changedEgg
          ? { eggId: startup.eggId, skipScripts: startup.skipScripts }
          : { ...startup, environment: env },
      ),
    onSuccess: refresh,
  })
  const action = useMutation({
    mutationFn: async (a: 'suspend' | 'unsuspend' | 'reinstall' | 'delete') => {
      if (a === 'suspend' || a === 'unsuspend')
        return api.post(`/admin/servers/${id}/suspend`, { suspended: a === 'suspend' })
      if (a === 'reinstall') return api.post(`/admin/servers/${id}/reinstall`)
      return api.delete(`/admin/servers/${id}${force ? '?force=1' : ''}`)
    },
    onSuccess: (_d, a) => {
      setConfirm(null)
      if (a === 'delete') navigate({ to: '/admin/servers' })
      else refresh()
    },
  })
  if (error)
    return (
      <Card>
        <Empty title="Server not found" />
      </Card>
    )
  if (!s) return null
  const free = allocations.data?.data.filter((a) => !a.serverId) ?? []
  const tabs = ['details', 'build', 'startup', 'manage'] as const

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-medium">
              {s.name}{' '}
              {s.status && <Pill tone={s.status === 'suspended' ? 'danger' : 'warn'}>{s.status}</Pill>}
            </h2>
            <p className="text-[13px] text-muted">
              <code>{s.uuid}</code> · {s.node.name} · {s.egg.name}
            </p>
          </div>
          <a
            href={`/server/${s.uuidShort}`}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
          >
            Open console <ExternalLink className="size-4" />
          </a>
        </div>
        <nav className="flex gap-1 border-t border-line px-3">
          {tabs.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                '-mb-px border-b-2 px-3 py-3 text-[13.5px] capitalize',
                tab === t ? 'border-primary font-medium' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </Card>

      {tab === 'details' && (
        <Card>
          <form
            className="grid gap-4 p-5 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              saveDetails.mutate()
            }}
          >
            <Field label="Name">
              <Input
                value={details.name}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
              />
            </Field>
            <Field label="Owner" hint="Changing the owner also removes them as a subuser">
              <OwnerPicker value={owner} onChange={setOwner} />
            </Field>
            <Field label="Description">
              <Input
                value={details.description}
                onChange={(e) => setDetails({ ...details, description: e.target.value })}
              />
            </Field>
            <Field label="External ID" hint="Used by integrations, e.g. service-12">
              <Input
                value={details.externalId}
                onChange={(e) => setDetails({ ...details, externalId: e.target.value })}
              />
            </Field>
            <div className="md:col-span-2">
              <SaveRow m={saveDetails} />
            </div>
          </form>
        </Card>
      )}

      {tab === 'build' && (
        <>
          <Card>
            <CardHeader title="Resources" subtitle="Changes apply the next time the server starts." />
            <form
              className="space-y-4 px-5 pb-5"
              onSubmit={(e) => {
                e.preventDefault()
                saveBuild.mutate()
              }}
            >
              <Limits v={build} set={(k, v) => setBuild((b) => ({ ...b, [k]: v }))} />
              <SaveRow m={saveBuild} />
            </form>
          </Card>
          <Card>
            <CardHeader title="Ports" />
            {ports.error && <p className="px-5 pb-3 text-[13px] text-danger">{ports.error.message}</p>}
            <div className="divide-y divide-line border-t border-line">
              {s.allocations.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
                  <code className="flex-1">
                    {a.ipAlias ?? a.ip}:{a.port}
                  </code>
                  {a.id === s.allocationId ? (
                    <Pill tone="info">Primary</Pill>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => ports.mutate({ allocationId: a.id })}>
                        Make primary
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => ports.mutate({ removeAllocations: [a.id] })}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2 p-5">
              <Field label="Add a free port">
                <select
                  className={`${selectClass} w-56`}
                  value={addPort}
                  onChange={(e) => setAddPort(e.target.value)}
                >
                  <option value="">Select…</option>
                  {free.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ipAlias ?? a.ip}:{a.port}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                variant="outline"
                disabled={!addPort}
                loading={ports.isPending}
                onClick={() => ports.mutate({ addAllocations: [Number(addPort)] })}
              >
                Add
              </Button>
            </div>
          </Card>
        </>
      )}

      {tab === 'startup' && (
        <Card>
          <form
            className="grid gap-4 p-5 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              saveStartup.mutate()
            }}
          >
            <Field
              label="Egg"
              hint={
                changedEgg
                  ? 'Saving switches the egg: variables reset to the new egg defaults. Reinstall afterwards.'
                  : undefined
              }
            >
              <select
                className={selectClass}
                value={startup.eggId}
                onChange={(e) => setStartup({ ...startup, eggId: Number(e.target.value) })}
              >
                {nests.data?.data.map((n) => (
                  <optgroup key={n.id} label={n.name}>
                    {n.eggs.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {!changedEgg && (
              <Field label="Docker image">
                <select
                  className={selectClass}
                  value={startup.image}
                  onChange={(e) => setStartup({ ...startup, image: e.target.value })}
                >
                  {Object.entries(s.egg.dockerImages).map(([label, img]) => (
                    <option key={img} value={img}>
                      {label}
                    </option>
                  ))}
                  {!Object.values(s.egg.dockerImages).includes(s.image) && (
                    <option value={s.image}>{s.image}</option>
                  )}
                </select>
              </Field>
            )}
            {!changedEgg && (
              <>
                <div className="md:col-span-2">
                  <Field label="Startup command" hint={`Egg default: ${s.egg.startup}`}>
                    <Input
                      value={startup.startup}
                      onChange={(e) => setStartup({ ...startup, startup: e.target.value })}
                    />
                  </Field>
                </div>
                {s.variables.map((v) => (
                  <Field key={v.envVariable} label={v.name} hint={`${v.envVariable} · ${v.rules}`}>
                    <Input
                      value={env[v.envVariable] ?? ''}
                      onChange={(e) => setEnv({ ...env, [v.envVariable]: e.target.value })}
                    />
                  </Field>
                ))}
              </>
            )}
            <span className="flex items-center gap-3 text-[13px] md:col-span-2">
              <Toggle
                checked={startup.skipScripts}
                onChange={(v) => setStartup({ ...startup, skipScripts: v })}
                label="Skip install scripts"
              />{' '}
              Skip the egg install script on (re)install
            </span>
            <div className="md:col-span-2">
              <SaveRow m={saveStartup} />
            </div>
          </form>
        </Card>
      )}

      {tab === 'manage' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader
              title={s.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
              subtitle={
                s.status === 'suspended'
                  ? 'Lets the owner use the server again.'
                  : 'Stops the server and blocks access for the owner and subusers.'
              }
            />
            <div className="px-5 pb-5">
              <Button
                variant="outline"
                loading={action.isPending && action.variables !== 'delete'}
                onClick={() => action.mutate(s.status === 'suspended' ? 'unsuspend' : 'suspend')}
              >
                {s.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Reinstall" subtitle="Runs the egg install script again." />
            <div className="px-5 pb-5">
              <Button variant="outline" onClick={() => setConfirm('reinstall')}>
                Reinstall
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Delete" subtitle="Removes the server, its files, databases and backups." />
            <div className="px-5 pb-5">
              <Button variant="danger" onClick={() => setConfirm('delete')}>
                Delete server
              </Button>
            </div>
          </Card>
          {action.error && !confirm && (
            <p className="text-[13px] text-danger md:col-span-3">{action.error.message}</p>
          )}
          <div className="md:col-span-3">
            <TransferCard serverId={s.id} currentNodeId={s.node.id} status={s.status} onDone={refresh} />
          </div>
        </div>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? `Delete ${s.name}?` : `Reinstall ${s.name}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={action.isPending} onClick={() => action.mutate(confirm!)}>
              {confirm === 'delete' ? 'Delete' : 'Reinstall'}
            </Button>
          </>
        }
      >
        {confirm === 'delete' ? (
          <>
            All files, databases and backups are removed. This cannot be undone.
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Force
              delete even if the node cannot be reached
            </label>
          </>
        ) : (
          'The server is stopped and the install script runs again. Files may be overwritten.'
        )}
        {action.error && <p className="mt-2 text-danger">{action.error.message}</p>}
      </Modal>
    </>
  )
}

type Transfer = {
  id: number
  successful: boolean | null
  error: string | null
  oldNodeId: number
  newNodeId: number
  createdAt: string
  updatedAt: string
}

/** Move the server to another node. */
function TransferCard({
  serverId,
  currentNodeId,
  status,
  onDone,
}: {
  serverId: number
  currentNodeId: number
  status: string | null
  onDone: () => void
}) {
  const nodes = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/admin/nodes'),
  })
  const last = useQuery({
    queryKey: ['admin', 'transfer', serverId],
    queryFn: () =>
      api.get<{ data: Transfer | null }>(`/admin/servers/${serverId}/transfer`).then((r) => r.data),
    refetchInterval: (q) => (q.state.data && q.state.data.successful === null ? 3000 : false),
  })
  const targets = nodes.data?.data.filter((n) => n.id !== currentNodeId) ?? []
  const [nodeId, setNodeId] = useState(0)
  const target = nodeId || targets[0]?.id || 0
  const ports = useQuery({
    queryKey: ['admin', 'allocations', target],
    enabled: !!target,
    queryFn: () => api.get<{ data: Allocation[] }>(`/admin/nodes/${target}/allocations`),
  })
  const free = ports.data?.data.filter((a) => !a.serverId) ?? []
  const [port, setPort] = useState(0)
  const start = useMutation({
    mutationFn: () =>
      api.post(`/admin/servers/${serverId}/transfer`, { nodeId: target, allocationId: port || free[0]?.id }),
    onSuccess: () => {
      last.refetch()
      onDone()
    },
  })
  const t = last.data
  const nodeName = (id: number) => nodes.data?.data.find((n) => n.id === id)?.name ?? `#${id}`
  // Refresh the server once when a running transfer finishes (not on every render).
  const seen = useRef('')
  useEffect(() => {
    if (!t) return
    const key = `${t.id}:${t.successful}`
    if (seen.current && seen.current !== key && t.successful !== null) onDone()
    seen.current = key
  }, [t, onDone])
  return (
    <Card>
      <CardHeader
        title="Transfer to another node"
        subtitle="The server is stopped, its files are copied to the new node, and it switches over once the copy is confirmed."
      />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
        {targets.length === 0 ? (
          <p className="text-[13px] text-muted">Add another node to transfer servers.</p>
        ) : (
          <>
            <Field label="Target node">
              <select
                className={`${selectClass} w-48`}
                value={target}
                onChange={(e) => {
                  setNodeId(Number(e.target.value))
                  setPort(0)
                }}
              >
                {targets.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New primary port">
              <select
                className={`${selectClass} w-48`}
                value={port || free[0]?.id || ''}
                onChange={(e) => setPort(Number(e.target.value))}
              >
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ipAlias ?? a.ip}:{a.port}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              loading={start.isPending}
              disabled={!free.length || status === 'transferring'}
              onClick={() => start.mutate()}
            >
              Start transfer
            </Button>
          </>
        )}
        {start.error && <p className="w-full text-[13px] text-danger">{start.error.message}</p>}
        {t && (
          <p className="w-full text-[13px]">
            {t.successful === null ? (
              <span className="text-warn">
                Transferring from {nodeName(t.oldNodeId)} to {nodeName(t.newNodeId)}…
              </span>
            ) : t.successful ? (
              <span className="text-success">
                Last transfer to {nodeName(t.newNodeId)} finished {formatDate(t.updatedAt, true)}.
              </span>
            ) : (
              <span className="text-danger">Last transfer failed: {t.error}</span>
            )}
          </p>
        )}
      </div>
    </Card>
  )
}

export function AdminServerPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  return id === 'new' ? <NewServer /> : <EditServer id={id} />
}
