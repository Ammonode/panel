import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardHeader, Empty, Input } from '../../components/ui'
import { api } from '../../lib/api'
import { serverCan } from '../../lib/server'
import { useServerContext } from './layout'

type Variable = {
  name: string
  description: string
  envVariable: string
  serverValue: string
  isEditable: boolean
  rules: string
}

function VariableField({ v }: { v: Variable }) {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const [value, setValue] = useState(v.serverValue)
  const save = useMutation({
    mutationFn: () =>
      api.put(`/client/servers/${server.identifier}/startup/variable`, { key: v.envVariable, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['startup', server.identifier] }),
  })
  const editable = v.isEditable && serverCan(server, 'startup.update')
  const options = v.rules.match(/(?:^|\|)in:([^|]+)/)?.[1]?.split(',')
  const commit = () => value !== v.serverValue && save.mutate()
  return (
    <div className="rounded-[12px] border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-medium">{v.name}</p>
        {save.isPending ? (
          <span className="text-xs text-muted">Saving…</span>
        ) : (
          save.isSuccess && <span className="text-xs text-success">Saved</span>
        )}
      </div>
      <div className="mt-2">
        {options ? (
          <select
            className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm disabled:opacity-60"
            value={value}
            disabled={!editable}
            onChange={(e) => {
              setValue(e.target.value)
              api
                .put(`/client/servers/${server.identifier}/startup/variable`, {
                  key: v.envVariable,
                  value: e.target.value,
                })
                .catch(() => {})
            }}
            aria-label={v.name}
          >
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : (
          <Input
            value={value}
            disabled={!editable}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            aria-label={v.name}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {save.error ? <span className="text-danger">{save.error.message}</span> : v.description}
      </p>
      <code className="mt-1 block text-[11px] text-subtle">{v.envVariable}</code>
    </div>
  )
}

export function StartupPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['startup', server.identifier],
    queryFn: () =>
      api.get<{ data: Variable[]; startup: string }>(`/client/servers/${server.identifier}/startup`),
  })
  const image = useMutation({
    mutationFn: (img: string) =>
      api.put(`/client/servers/${server.identifier}/settings/docker-image`, { image: img }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server'] }),
  })
  const images = Object.entries(server.egg?.dockerImages ?? {})
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Startup command" />
          <pre className="mx-5 mb-5 overflow-x-auto rounded-[12px] bg-[#0f1117] p-4 font-mono text-[12.5px] whitespace-pre-wrap text-[#d7dae0]">
            {data?.startup}
          </pre>
        </Card>
        <Card>
          <CardHeader title="Docker image" />
          <div className="px-5 pb-5">
            <select
              className="h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm disabled:opacity-60"
              value={server.image}
              disabled={!serverCan(server, 'startup.docker-image') || images.length < 2}
              onChange={(e) => image.mutate(e.target.value)}
              aria-label="Docker image"
            >
              {images.map(([label, img]) => (
                <option key={img} value={img}>
                  {label}
                </option>
              ))}
              {!images.some(([, img]) => img === server.image) && (
                <option value={server.image}>{server.image}</option>
              )}
            </select>
            <p className="mt-2 text-xs text-muted">
              {image.error ? (
                <span className="text-danger">{image.error.message}</span>
              ) : (
                'Changes apply the next time the server starts.'
              )}
            </p>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Variables" />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
          {data?.data.map((v) => (
            <VariableField key={v.envVariable} v={v} />
          ))}
        </div>
        {data?.data.length === 0 && <Empty title="This server has no editable variables" />}
      </Card>
    </>
  )
}
