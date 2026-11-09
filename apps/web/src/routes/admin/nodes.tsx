import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Pill } from '../../components/ui'
import { api, formatDate } from '../../lib/api'

type Location = { id: number; short: string; long: string | null; nodeCount: number }
type Node = {
  id: number
  name: string
  fqdn: string
  scheme: string
  memory: number
  disk: number
  locationId: number
  maintenance: boolean
  lastHeartbeatAt: string | null
}

export function AdminLocationsPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ short: '', long: '' })
  const list = useQuery({
    queryKey: ['admin', 'locations'],
    queryFn: () => api.get<{ data: Location[] }>('/admin/locations'),
  })
  const create = useMutation({
    mutationFn: () => api.post('/admin/locations', form),
    onSuccess: () => {
      setForm({ short: '', long: '' })
      qc.invalidateQueries({ queryKey: ['admin', 'locations'] })
    },
  })
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Locations" />
        <div className="divide-y divide-line border-t border-line">
          {list.data?.data.length === 0 && <Empty title="No locations yet" />}
          {list.data?.data.map((l) => (
            <div key={l.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div>
                <p className="font-medium">{l.short}</p>
                <p className="text-xs text-muted">{l.long}</p>
              </div>
              <Pill>{l.nodeCount} nodes</Pill>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="New location" />
        <form
          className="space-y-4 px-5 pb-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Short code" hint="e.g. sg-1">
            <Input value={form.short} onChange={(e) => setForm({ ...form, short: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={form.long} onChange={(e) => setForm({ ...form, long: e.target.value })} />
          </Field>
          {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
          <Button type="submit" loading={create.isPending}>
            Create location
          </Button>
        </form>
      </Card>
    </div>
  )
}

export function AdminNodesPage() {
  const qc = useQueryClient()
  const locations = useQuery({
    queryKey: ['admin', 'locations'],
    queryFn: () => api.get<{ data: Location[] }>('/admin/locations'),
  })
  const nodes = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: () => api.get<{ data: Node[] }>('/admin/nodes'),
  })
  const [form, setForm] = useState({
    name: '',
    fqdn: '',
    scheme: 'https',
    memory: 4096,
    disk: 51200,
    locationId: 0,
  })
  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/nodes', { ...form, locationId: form.locationId || locations.data?.data[0]?.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  })
  const online = (n: Node) =>
    !!n.lastHeartbeatAt && Date.now() - new Date(n.lastHeartbeatAt).getTime() < 90_000
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Nodes" subtitle="Machines running the Ammonode daemon." />
        <div className="divide-y divide-line border-t border-line">
          {nodes.data?.data.length === 0 && (
            <Empty title="No nodes yet">Create a node, then install the daemon on it.</Empty>
          )}
          {nodes.data?.data.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium">{n.name}</p>
                <p className="text-xs text-muted">
                  {n.scheme}://{n.fqdn} · {n.memory} MiB · {Math.round(n.disk / 1024)} GiB
                </p>
              </div>
              {n.maintenance ? (
                <Pill tone="warn">Maintenance</Pill>
              ) : online(n) ? (
                <Pill dot tone="success">
                  Online
                </Pill>
              ) : (
                <Pill tone="neutral">
                  {n.lastHeartbeatAt ? `Seen ${formatDate(n.lastHeartbeatAt, true)}` : 'Never connected'}
                </Pill>
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="New node" />
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
          <Field label="FQDN" hint="Domain or IP the panel uses to reach the daemon">
            <Input value={form.fqdn} onChange={(e) => setForm({ ...form, fqdn: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Memory (MiB)">
              <Input
                type="number"
                value={form.memory}
                onChange={(e) => setForm({ ...form, memory: Number(e.target.value) })}
              />
            </Field>
            <Field label="Disk (MiB)">
              <Input
                type="number"
                value={form.disk}
                onChange={(e) => setForm({ ...form, disk: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Location">
            <select
              className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm"
              value={form.locationId}
              onChange={(e) => setForm({ ...form, locationId: Number(e.target.value) })}
            >
              {locations.data?.data.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.short}
                </option>
              ))}
            </select>
          </Field>
          {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
          <Button type="submit" loading={create.isPending} disabled={!locations.data?.data.length}>
            Create node
          </Button>
        </form>
      </Card>
    </div>
  )
}

type DatabaseHost = {
  id: number
  name: string
  host: string
  port: number
  username: string
  maxDatabases: number | null
  databases: number
}

export function AdminDatabaseHostsPage() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['admin', 'database-hosts'],
    queryFn: () => api.get<{ data: DatabaseHost[] }>('/admin/database-hosts'),
  })
  const [form, setForm] = useState({
    name: '',
    host: '127.0.0.1',
    port: 3306,
    username: '',
    password: '',
    maxDatabases: '',
  })
  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/database-hosts', {
        ...form,
        maxDatabases: form.maxDatabases ? Number(form.maxDatabases) : null,
      }),
    onSuccess: () => {
      setForm({ name: '', host: '127.0.0.1', port: 3306, username: '', password: '', maxDatabases: '' })
      qc.invalidateQueries({ queryKey: ['admin', 'database-hosts'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/database-hosts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'database-hosts'] }),
  })
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title="Database hosts"
          subtitle="MySQL or MariaDB servers where customer databases are created."
        />
        {remove.error && <p className="px-5 pb-3 text-[13px] text-danger">{remove.error.message}</p>}
        <div className="divide-y divide-line border-t border-line">
          {list.data?.data.length === 0 && <Empty title="No database hosts yet" />}
          {list.data?.data.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium">{h.name}</p>
                <p className="text-xs text-muted">
                  {h.username}@{h.host}:{h.port}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <Pill>
                  {h.databases}
                  {h.maxDatabases ? ` / ${h.maxDatabases}` : ''} databases
                </Pill>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(h.id)}>
                  Delete
                </Button>
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="New host"
          subtitle="The user needs permission to create databases and users (GRANT OPTION)."
        />
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
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <Field label="Host">
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </Field>
            <Field label="Port">
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Username">
            <Input
              value={form.username}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Max databases" hint="Empty = unlimited">
            <Input
              type="number"
              min={1}
              value={form.maxDatabases}
              onChange={(e) => setForm({ ...form, maxDatabases: e.target.value })}
            />
          </Field>
          {create.error && <p className="text-[13px] text-danger">{create.error.message}</p>}
          <Button type="submit" loading={create.isPending}>
            Test and save
          </Button>
        </form>
      </Card>
    </div>
  )
}
