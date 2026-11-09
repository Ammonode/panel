import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Copy, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api } from '../../lib/api'

type Node = {
  id: number
  name: string
  description: string | null
  locationId: number
  fqdn: string
  scheme: string
  behindProxy: boolean
  public: boolean
  maintenance: boolean
  memory: number
  memoryOverallocate: number
  disk: number
  diskOverallocate: number
  uploadSize: number
  daemonListen: number
  daemonSftp: number
  daemonBase: string
}
type Allocation = {
  id: number
  ip: string
  ipAlias: string | null
  port: number
  serverId: number | null
  notes: string | null
}
type System = {
  version: string
  os: string
  kernel_version: string
  architecture: string
  cpu_count: number
  memory_bytes: number
  docker_version: string
  containers: number
}
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

export function AdminNodePage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const qc = useQueryClient()
  const navigate = useNavigate()
  const node = useQuery({
    queryKey: ['admin', 'node', id],
    queryFn: () => api.get<{ data: Node }>(`/admin/nodes/${id}`).then((r) => r.data),
  })
  const locations = useQuery({
    queryKey: ['admin', 'locations'],
    queryFn: () => api.get<{ data: { id: number; short: string }[] }>('/admin/locations'),
  })
  const system = useQuery({
    queryKey: ['admin', 'node-system', id],
    queryFn: () =>
      api.get<{ data: System | null; online: boolean; error?: string }>(`/admin/nodes/${id}/system`),
    refetchInterval: 30_000,
  })
  const allocations = useQuery({
    queryKey: ['admin', 'allocations', Number(id)],
    queryFn: () => api.get<{ data: Allocation[] }>(`/admin/nodes/${id}/allocations`),
  })
  const [form, setForm] = useState<Node | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [add, setAdd] = useState({ ip: '', alias: '', ports: '' })
  const [confirm, setConfirm] = useState<null | 'reset' | 'delete'>(null)
  useEffect(() => {
    if (node.data) setForm(node.data)
  }, [node.data])
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/nodes/${id}`, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'node', id] }),
  })
  const reveal = useMutation({
    mutationFn: () => api.get<{ command: string }>(`/admin/nodes/${id}/configuration`),
    onSuccess: (r) => setCommand(r.command),
  })
  const reset = useMutation({
    mutationFn: () => api.post(`/admin/nodes/${id}/reset-token`),
    onSuccess: () => {
      setCommand(null)
      setConfirm(null)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/nodes/${id}`),
    onSuccess: () => navigate({ to: '/admin/nodes' }),
  })
  const refreshAlloc = () => {
    setSelected([])
    qc.invalidateQueries({ queryKey: ['admin', 'allocations', Number(id)] })
  }
  const addPorts = useMutation({
    mutationFn: () =>
      api.post(`/admin/nodes/${id}/allocations`, {
        ip: add.ip,
        alias: add.alias || null,
        ports: add.ports.split(/[\s,]+/).filter(Boolean),
      }),
    onSuccess: () => {
      setAdd({ ...add, ports: '' })
      refreshAlloc()
    },
  })
  const delPorts = useMutation({
    mutationFn: () => api.delete(`/admin/nodes/${id}/allocations`, { ids: selected }),
    onSuccess: refreshAlloc,
  })
  const setAlias = useMutation({
    mutationFn: ({ a, alias }: { a: number; alias: string }) =>
      api.patch(`/admin/nodes/${id}/allocations/${a}`, { ipAlias: alias || null }),
    onSuccess: refreshAlloc,
  })

  if (node.error)
    return (
      <Card>
        <Empty title="Node not found" />
      </Card>
    )
  if (!form) return null
  const num = (k: keyof Node, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        value={String(form[k])}
        onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
      />
    </Field>
  )
  const sys = system.data?.data
  const free = allocations.data?.data.filter((a) => !a.serverId) ?? []

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-medium">
              {form.name}{' '}
              {system.data?.online ? (
                <Pill tone="success" dot>
                  Online
                </Pill>
              ) : system.data ? (
                <Pill tone="danger" dot>
                  Offline
                </Pill>
              ) : null}
            </h2>
            <p className="text-[13px] text-muted">
              {sys
                ? `${sys.os} · kernel ${sys.kernel_version} · Docker ${sys.docker_version} · ${sys.cpu_count} CPU · ${(sys.memory_bytes / 1024 ** 3).toFixed(1)} GiB · daemon ${sys.version}`
                : (system.data?.error ?? 'Checking…')}
            </p>
          </div>
          <Link to="/admin/nodes" className="text-[13px] text-muted hover:text-fg">
            All nodes
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Daemon configuration"
          subtitle="Run this on the node after installing the daemon, then start the service."
        />
        <div className="space-y-3 px-5 pb-5">
          {command ? (
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded-[10px] bg-[#0f1117] p-3 font-mono text-xs whitespace-pre-wrap break-all text-[#d7dae0]">
                {command}
              </pre>
              <Button
                size="sm"
                variant="outline"
                aria-label="Copy"
                onClick={() => navigator.clipboard?.writeText(command)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" loading={reveal.isPending} onClick={() => reveal.mutate()}>
              <Eye className="size-4" /> Show configure command
            </Button>
          )}
          <p className="text-xs text-muted">
            The command contains this node's secret token. If it leaks,{' '}
            <button type="button" className="underline" onClick={() => setConfirm('reset')}>
              reset the token
            </button>{' '}
            and reconfigure the daemon.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Settings" />
        <form
          className="grid gap-4 px-5 pb-5 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Location">
            <select
              className={selectClass}
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
          <Field label="Description">
            <Input
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="FQDN" hint="Domain or IP browsers use to reach the daemon">
            <Input value={form.fqdn} onChange={(e) => setForm({ ...form, fqdn: e.target.value })} />
          </Field>
          <Field label="Connection">
            <select
              className={selectClass}
              value={form.scheme}
              onChange={(e) => setForm({ ...form, scheme: e.target.value })}
            >
              <option value="https">HTTPS (recommended)</option>
              <option value="http">HTTP</option>
            </select>
          </Field>
          {num('daemonListen', 'Daemon port')}
          {num('memory', 'Memory (MiB)')}
          {num('memoryOverallocate', 'Memory overallocation (%)', '-1 = no limit')}
          {num('daemonSftp', 'SFTP port')}
          {num('disk', 'Disk (MiB)')}
          {num('diskOverallocate', 'Disk overallocation (%)', '-1 = no limit')}
          {num('uploadSize', 'Upload limit (MiB)')}
          <div className="flex flex-wrap gap-6 text-[13px] md:col-span-3">
            <span className="flex items-center gap-2">
              <Toggle
                checked={form.public}
                onChange={(v) => setForm({ ...form, public: v })}
                label="Public"
              />{' '}
              Used for automatic deployments
            </span>
            <span className="flex items-center gap-2">
              <Toggle
                checked={form.maintenance}
                onChange={(v) => setForm({ ...form, maintenance: v })}
                label="Maintenance"
              />{' '}
              Maintenance mode
            </span>
            <span className="flex items-center gap-2">
              <Toggle
                checked={form.behindProxy}
                onChange={(v) => setForm({ ...form, behindProxy: v })}
                label="Behind proxy"
              />{' '}
              Behind a proxy
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 md:col-span-3">
            <Button type="button" variant="ghost" onClick={() => setConfirm('delete')}>
              Delete node
            </Button>
            <span className="flex items-center gap-3">
              {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
              {save.isSuccess && <span className="text-[13px] text-success">Saved</span>}
              <Button type="submit" loading={save.isPending}>
                Save
              </Button>
            </span>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Ports"
          subtitle={`${allocations.data?.data.length ?? 0} allocations, ${free.length} free`}
          action={
            selected.length > 0 && (
              <Button variant="danger" loading={delPorts.isPending} onClick={() => delPorts.mutate()}>
                Delete {selected.length}
              </Button>
            )
          }
        />
        <form
          className="flex flex-wrap items-end gap-2 px-5 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            addPorts.mutate()
          }}
        >
          <Field label="IP address">
            <Input
              className="w-40"
              placeholder="0.0.0.0"
              value={add.ip}
              onChange={(e) => setAdd({ ...add, ip: e.target.value })}
            />
          </Field>
          <Field label="Alias (optional)">
            <Input
              className="w-44"
              placeholder="play.example.com"
              value={add.alias}
              onChange={(e) => setAdd({ ...add, alias: e.target.value })}
            />
          </Field>
          <Field label="Ports">
            <Input
              className="w-56"
              placeholder="25565, 25570-25580"
              value={add.ports}
              onChange={(e) => setAdd({ ...add, ports: e.target.value })}
            />
          </Field>
          <Button type="submit" loading={addPorts.isPending} disabled={!add.ip || !add.ports}>
            Add
          </Button>
          {addPorts.error && <span className="w-full text-[13px] text-danger">{addPorts.error.message}</span>}
        </form>
        <div className="max-h-[480px] divide-y divide-line overflow-y-auto border-t border-line">
          {allocations.data?.data.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-[13px]">
              <input
                type="checkbox"
                aria-label={`Select ${a.ip}:${a.port}`}
                disabled={!!a.serverId}
                checked={selected.includes(a.id)}
                onChange={(e) =>
                  setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))
                }
              />
              <code className="w-44">
                {a.ip}:{a.port}
              </code>
              <input
                className="h-8 w-48 rounded-lg border border-line bg-surface px-2 text-xs"
                defaultValue={a.ipAlias ?? ''}
                placeholder="Alias"
                aria-label={`Alias for ${a.port}`}
                onBlur={(e) =>
                  e.target.value !== (a.ipAlias ?? '') && setAlias.mutate({ a: a.id, alias: e.target.value })
                }
              />
              <span className="flex-1" />
              {a.serverId ? (
                <Link to="/admin/servers/$id" params={{ id: String(a.serverId) }}>
                  <Pill tone="info">Server #{a.serverId}</Pill>
                </Link>
              ) : (
                <Pill>Free</Pill>
              )}
            </div>
          ))}
          {allocations.data?.data.length === 0 && <Empty title="No ports yet" />}
        </div>
      </Card>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'reset' ? 'Reset the node token?' : `Delete ${form.name}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={reset.isPending || remove.isPending}
              onClick={() => (confirm === 'reset' ? reset.mutate() : remove.mutate())}
            >
              {confirm === 'reset' ? 'Reset token' : 'Delete'}
            </Button>
          </>
        }
      >
        {confirm === 'reset'
          ? 'The daemon stops working until you run the new configure command on the node.'
          : 'Only nodes without servers can be deleted.'}
        {(reset.error || remove.error) && (
          <p className="mt-2 text-danger">{(reset.error ?? remove.error)?.message}</p>
        )}
      </Modal>
    </>
  )
}
