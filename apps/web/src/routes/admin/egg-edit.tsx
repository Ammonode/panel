import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Download, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { api } from '../../lib/api'

type Variable = {
  id: number
  name: string
  description: string
  envVariable: string
  defaultValue: string
  userViewable: boolean
  userEditable: boolean
  rules: string
}
type Egg = {
  id: number
  nestId: number
  name: string
  author: string
  description: string | null
  startup: string
  dockerImages: Record<string, string>
  features: string[]
  fileDenylist: string[]
  forceOutgoingIp: boolean
  config: {
    files: Record<string, unknown>
    startup: { done: string | string[] }
    logs: Record<string, unknown>
    stop: string
  }
  scriptContainer: string
  scriptEntry: string
  scriptInstall: string | null
  scriptIsPrivileged: boolean
  sourceUrl: string | null
  variables: Variable[]
}
const textarea =
  'w-full rounded-[10px] border border-line bg-surface p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent'
const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

const blank = (nestId: number) => ({
  nestId,
  name: '',
  author: '',
  description: '',
  startup: '',
  images: 'Java 21|ghcr.io/ptero-eggs/yolks:java_21',
  features: '',
  denylist: '',
  forceOutgoingIp: false,
  files: '{}',
  logs: '{}',
  done: '',
  stop: '^C',
  scriptContainer: 'ghcr.io/ptero-eggs/installers:alpine',
  scriptEntry: 'ash',
  scriptInstall: '#!/bin/ash\ncd /mnt/server\n',
  scriptIsPrivileged: true,
})
type Form = ReturnType<typeof blank>

function toForm(e: Egg): Form {
  return {
    nestId: e.nestId,
    name: e.name,
    author: e.author,
    description: e.description ?? '',
    startup: e.startup,
    images: Object.entries(e.dockerImages)
      .map(([k, v]) => `${k}|${v}`)
      .join('\n'),
    features: e.features.join(', '),
    denylist: e.fileDenylist.join('\n'),
    forceOutgoingIp: e.forceOutgoingIp,
    files: JSON.stringify(e.config.files ?? {}, null, 2),
    logs: JSON.stringify(e.config.logs ?? {}, null, 2),
    done: (Array.isArray(e.config.startup?.done) ? e.config.startup.done : [e.config.startup?.done ?? ''])
      .filter(Boolean)
      .join('\n'),
    stop: e.config.stop,
    scriptContainer: e.scriptContainer,
    scriptEntry: e.scriptEntry,
    scriptInstall: e.scriptInstall ?? '',
    scriptIsPrivileged: e.scriptIsPrivileged,
  }
}

/** Turns the form into the API payload, throwing readable errors for bad JSON. */
function toBody(f: Form) {
  const parse = (label: string, v: string) => {
    try {
      return JSON.parse(v || '{}')
    } catch {
      throw new Error(`${label} is not valid JSON`)
    }
  }
  const dockerImages = Object.fromEntries(
    f.images
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [label, image] = l.includes('|') ? (l.split('|', 2) as [string, string]) : [l, l]
        return [label.trim(), image.trim()]
      }),
  )
  const done = f.done
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return {
    nestId: f.nestId,
    name: f.name,
    author: f.author,
    description: f.description || null,
    startup: f.startup,
    dockerImages,
    features: f.features
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    fileDenylist: f.denylist
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    forceOutgoingIp: f.forceOutgoingIp,
    config: {
      files: parse('Configuration files', f.files),
      startup: { done: done.length === 1 ? done[0]! : done },
      logs: parse('Logs', f.logs),
      stop: f.stop,
    },
    scriptContainer: f.scriptContainer,
    scriptEntry: f.scriptEntry,
    scriptInstall: f.scriptInstall,
    scriptIsPrivileged: f.scriptIsPrivileged,
  }
}

function VariableModal({
  eggId,
  variable,
  onClose,
}: {
  eggId: number
  variable: Partial<Variable> | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [v, setV] = useState<Partial<Variable>>({})
  useEffect(() => setV(variable ?? {}), [variable])
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name,
        description: v.description ?? '',
        envVariable: v.envVariable,
        defaultValue: v.defaultValue ?? '',
        userViewable: v.userViewable ?? true,
        userEditable: v.userEditable ?? true,
        rules: v.rules || 'nullable|string',
      }
      return v.id
        ? api.patch(`/admin/eggs/${eggId}/variables/${v.id}`, body)
        : api.post(`/admin/eggs/${eggId}/variables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'egg', eggId] })
      onClose()
    },
  })
  return (
    <Modal
      open={!!variable}
      onClose={onClose}
      title={v.id ? `Edit ${v.name}` : 'New variable'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-fg">
        <Field label="Name">
          <Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Environment variable">
          <Input
            value={v.envVariable ?? ''}
            placeholder="SERVER_JARFILE"
            onChange={(e) => setV({ ...v, envVariable: e.target.value.toUpperCase() })}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Description">
            <Input
              value={v.description ?? ''}
              onChange={(e) => setV({ ...v, description: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Default value">
          <Input
            value={v.defaultValue ?? ''}
            onChange={(e) => setV({ ...v, defaultValue: e.target.value })}
          />
        </Field>
        <Field label="Rules" hint="e.g. required|string|max:20">
          <Input
            value={v.rules ?? 'nullable|string'}
            onChange={(e) => setV({ ...v, rules: e.target.value })}
          />
        </Field>
        <span className="flex items-center gap-2 text-[13px]">
          <Toggle
            checked={v.userViewable ?? true}
            onChange={(x) => setV({ ...v, userViewable: x })}
            label="Users can view"
          />{' '}
          Users can view
        </span>
        <span className="flex items-center gap-2 text-[13px]">
          <Toggle
            checked={v.userEditable ?? true}
            onChange={(x) => setV({ ...v, userEditable: x })}
            label="Users can edit"
          />{' '}
          Users can edit
        </span>
        {save.error && <p className="col-span-2 text-danger">{save.error.message}</p>}
      </div>
    </Modal>
  )
}

export function AdminEggEditPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const isNew = id === 'new'
  const nestParam = Number(new URLSearchParams(location.search).get('nest') ?? 0)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const nests = useQuery({
    queryKey: ['admin', 'nests'],
    queryFn: () => api.get<{ data: { id: number; name: string }[] }>('/admin/nests'),
  })
  const egg = useQuery({
    queryKey: ['admin', 'egg', Number(id)],
    enabled: !isNew,
    queryFn: () => api.get<{ data: Egg }>(`/admin/eggs/${id}`).then((r) => r.data),
  })
  const [form, setForm] = useState<Form>(blank(nestParam))
  const [variable, setVariable] = useState<Partial<Variable> | null>(null)
  useEffect(() => {
    if (egg.data) setForm(toForm(egg.data))
  }, [egg.data])
  useEffect(() => {
    if (isNew && !form.nestId && nests.data?.data[0])
      setForm((f) => ({ ...f, nestId: nests.data!.data[0]!.id }))
  }, [isNew, nests.data, form.nestId])
  const save = useMutation({
    mutationFn: async () => {
      const body = toBody(form)
      if (isNew) {
        const { nestId, ...rest } = body
        return api.post<{ data: { id: number } }>(`/admin/nests/${nestId}/eggs`, rest)
      }
      return api.patch<{ data: { id: number } }>(`/admin/eggs/${id}`, body)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'nests'] })
      if (isNew) navigate({ to: '/admin/eggs/$id', params: { id: String(r.data.id) } })
      else qc.invalidateQueries({ queryKey: ['admin', 'egg', Number(id)] })
    },
  })
  const removeVar = useMutation({
    mutationFn: (v: number) => api.delete(`/admin/eggs/${id}/variables/${v}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'egg', Number(id)] }),
  })
  const set =
    <K extends keyof Form>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: k === 'nestId' ? Number(e.target.value) : e.target.value })
  const err = save.error as (Error & { details?: Record<string, string> }) | null

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <Card>
        <CardHeader
          title={isNew ? 'New egg' : form.name}
          subtitle={
            egg.data?.sourceUrl
              ? 'Imported from the official catalog. Re-importing from the catalog overwrites your changes.'
              : undefined
          }
          action={
            !isNew && (
              <a
                href={`/api/admin/eggs/${id}/export`}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm hover:bg-surface-2"
              >
                <Download className="size-4" /> Export
              </a>
            )
          }
        />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-3">
          <Field label="Name" error={err?.details?.name}>
            <Input value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Author" error={err?.details?.author}>
            <Input value={form.author} placeholder="you@example.com" onChange={set('author')} />
          </Field>
          <Field label="Nest">
            <select className={selectClass} value={form.nestId} onChange={set('nestId')}>
              {nests.data?.data.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-3">
            <Field label="Description">
              <Input value={form.description} onChange={set('description')} />
            </Field>
          </div>
          <div className="md:col-span-3">
            <Field label="Startup command" hint="Use {{VARIABLE}} placeholders" error={err?.details?.startup}>
              <Input className="font-mono" value={form.startup} onChange={set('startup')} />
            </Field>
          </div>
          <Field label="Docker images" hint="One per line: Label|image" error={err?.details?.dockerImages}>
            <textarea className={`${textarea} h-28`} value={form.images} onChange={set('images')} />
          </Field>
          <Field label="File deny list" hint="Files users cannot open, one per line">
            <textarea className={`${textarea} h-28`} value={form.denylist} onChange={set('denylist')} />
          </Field>
          <Field label="Features" hint="Comma separated, e.g. eula, java_version">
            <Input value={form.features} onChange={set('features')} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Process management"
          subtitle="How the daemon detects a started server, stops it and rewrites config files."
        />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field
            label="Startup done text"
            hint="Console text that means the server is running, one per line. Prefix regex: for a regular expression."
          >
            <textarea className={`${textarea} h-24`} value={form.done} onChange={set('done')} />
          </Field>
          <Field label="Stop command" hint="^C sends SIGINT">
            <Input className="font-mono" value={form.stop} onChange={set('stop')} />
          </Field>
          <Field
            label="Configuration files (JSON)"
            hint='{"server.properties": {"parser": "properties", "find": {"server-port": "{{server.build.default.port}}"}}}'
            error={err?.details?.['config.files']}
          >
            <textarea className={`${textarea} h-56`} value={form.files} onChange={set('files')} />
          </Field>
          <Field label="Logs (JSON)">
            <textarea className={`${textarea} h-56`} value={form.logs} onChange={set('logs')} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Install script"
          subtitle="Runs in its own container with the server files mounted at /mnt/server."
        />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-3">
          <Field label="Install container">
            <Input className="font-mono" value={form.scriptContainer} onChange={set('scriptContainer')} />
          </Field>
          <Field label="Entrypoint">
            <Input className="font-mono" value={form.scriptEntry} onChange={set('scriptEntry')} />
          </Field>
          <span className="flex items-end gap-2 pb-2 text-[13px]">
            <Toggle
              checked={form.scriptIsPrivileged}
              onChange={(v) => setForm({ ...form, scriptIsPrivileged: v })}
              label="Privileged"
            />{' '}
            Run as root
          </span>
          <div className="md:col-span-3">
            <textarea
              aria-label="Install script"
              className={`${textarea} h-80 bg-[#0f1117] text-[#d7dae0]`}
              spellCheck={false}
              value={form.scriptInstall}
              onChange={set('scriptInstall')}
            />
          </div>
        </div>
      </Card>
      <div className="flex items-center justify-between gap-3">
        <Link to="/admin/eggs" className="text-[13px] text-muted hover:text-fg">
          Back to nests
        </Link>
        <div className="flex items-center gap-3">
          {save.error && <span className="text-[13px] text-danger">{save.error.message}</span>}
          {save.isSuccess && !isNew && <span className="text-[13px] text-success">Saved</span>}
          <Button type="submit" loading={save.isPending}>
            {isNew ? 'Create egg' : 'Save egg'}
          </Button>
        </div>
      </div>
      {!isNew && egg.data && (
        <Card>
          <CardHeader
            title="Variables"
            subtitle="Values customers can set; also passed to the install script."
            action={
              <Button type="button" variant="outline" onClick={() => setVariable({})}>
                <Plus className="size-4" /> Add variable
              </Button>
            }
          />
          <div className="divide-y divide-line border-t border-line">
            {egg.data.variables.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
                <span className="min-w-48 flex-1">
                  <span className="font-medium">{v.name}</span>
                  <code className="block text-xs text-muted">
                    {v.envVariable} = {v.defaultValue || '""'}
                  </code>
                </span>
                <code className="text-xs text-muted">{v.rules}</code>
                {!v.userViewable && <Pill>Hidden</Pill>}
                {v.userViewable && !v.userEditable && <Pill>Read only</Pill>}
                <Button type="button" size="sm" variant="outline" onClick={() => setVariable(v)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${v.name}`}
                  onClick={() => removeVar.mutate(v.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {egg.data.variables.length === 0 && <Empty title="No variables" />}
          </div>
        </Card>
      )}
      {!isNew && <VariableModal eggId={Number(id)} variable={variable} onClose={() => setVariable(null)} />}
    </form>
  )
}
