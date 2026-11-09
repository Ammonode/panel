import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill } from '../../components/ui'
import { api } from '../../lib/api'
import { serverCan } from '../../lib/server'
import { useServerContext } from './layout'

type Allocation = { id: number; ip: string; port: number; notes: string | null; isDefault: boolean }

export function NetworkPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const base = `/client/servers/${server.identifier}/network/allocations`
  const { data } = useQuery({
    queryKey: ['allocations', server.identifier],
    queryFn: () => api.get<{ data: Allocation[]; limit: number }>(base),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['allocations', server.identifier] })
  const add = useMutation({ mutationFn: () => api.post(base), onSuccess: refresh })
  const primary = useMutation({
    mutationFn: (id: number) => api.post(`${base}/${id}/primary`),
    onSuccess: () => {
      refresh()
      qc.invalidateQueries({ queryKey: ['server'] })
    },
  })
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`${base}/${id}`), onSuccess: refresh })
  const notes = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      api.patch(`${base}/${id}`, { notes: value || null }),
  })
  const extra = (data?.data.length ?? 1) - 1
  const limit = data?.limit ?? 0
  const err = add.error ?? primary.error ?? remove.error ?? notes.error
  return (
    <Card>
      <CardHeader
        title="Network"
        subtitle={`Addresses players use to connect. ${extra} of ${limit} extra ports used. Changes apply after a restart.`}
        action={
          serverCan(server, 'allocation.create') && (
            <Button disabled={extra >= limit} loading={add.isPending} onClick={() => add.mutate()}>
              Add port
            </Button>
          )
        }
      />
      {err && <p className="px-5 pb-3 text-[13px] text-danger">{err.message}</p>}
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <code className="w-48">
              {a.ip}:{a.port}
            </code>
            <input
              className="h-8 min-w-40 flex-1 rounded-lg border border-line bg-surface px-2 text-xs disabled:opacity-60"
              defaultValue={a.notes ?? ''}
              placeholder="Notes, e.g. Dynmap"
              aria-label={`Notes for port ${a.port}`}
              disabled={!serverCan(server, 'allocation.update')}
              onBlur={(e) =>
                e.target.value !== (a.notes ?? '') && notes.mutate({ id: a.id, value: e.target.value })
              }
            />
            {a.isDefault ? (
              <Pill tone="info">Primary</Pill>
            ) : (
              serverCan(server, 'allocation.update') && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => primary.mutate(a.id)}>
                    Make primary
                  </Button>
                  {serverCan(server, 'allocation.delete') && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>
                      Remove
                    </Button>
                  )}
                </span>
              )
            )}
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No allocations" />}
      </div>
    </Card>
  )
}

export function SettingsPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [confirm, setConfirm] = useState(false)
  const rename = useMutation({
    mutationFn: () => api.post(`/client/servers/${server.identifier}/settings/rename`, { name, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server'] }),
  })
  const reinstall = useMutation({
    mutationFn: () => api.post(`/client/servers/${server.identifier}/settings/reinstall`),
    onSuccess: () => {
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['server'] })
    },
  })
  const sftpUrl = `sftp://${server.sftp.username}@${server.sftp.host}:${server.sftp.port}`
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {serverCan(server, 'settings.rename') && (
          <Card>
            <CardHeader title="Server details" />
            <form
              className="space-y-4 px-5 pb-5"
              onSubmit={(e) => {
                e.preventDefault()
                rename.mutate()
              }}
            >
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              {rename.error && <p className="text-[13px] text-danger">{rename.error.message}</p>}
              <Button type="submit" loading={rename.isPending}>
                {rename.isSuccess ? 'Saved' : 'Save'}
              </Button>
            </form>
          </Card>
        )}
        <Card>
          <CardHeader title="Debug information" />
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 px-5 pb-5 text-[13px]">
            <dt className="text-muted">Node</dt>
            <dd>{server.node}</dd>
            <dt className="text-muted">Server ID</dt>
            <dd>
              <code>{server.uuid}</code>
            </dd>
            <dt className="text-muted">Egg</dt>
            <dd>{server.egg?.name}</dd>
          </dl>
        </Card>
      </div>
      <div className="space-y-4">
        {serverCan(server, 'file.sftp') && (
          <Card>
            <CardHeader title="SFTP details" subtitle="Use your panel password to log in." />
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 px-5 pb-5 text-[13px]">
              <dt className="text-muted">Address</dt>
              <dd>
                <code>{sftpUrl}</code>
              </dd>
              <dt className="text-muted">Username</dt>
              <dd>
                <code>{server.sftp.username}</code>
              </dd>
            </dl>
          </Card>
        )}
        {serverCan(server, 'settings.reinstall') && (
          <Card>
            <CardHeader
              title="Reinstall server"
              subtitle="Stops the server and runs the egg install script again. Some files may be deleted or changed."
            />
            <div className="px-5 pb-5">
              <Button variant="danger" disabled={!!server.status} onClick={() => setConfirm(true)}>
                Reinstall
              </Button>
            </div>
          </Card>
        )}
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reinstall this server?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reinstall.isPending} onClick={() => reinstall.mutate()}>
              Reinstall
            </Button>
          </>
        }
      >
        The server will be stopped and the install script will run again.
        {reinstall.error && <p className="mt-2 text-danger">{reinstall.error.message}</p>}
      </Modal>
    </div>
  )
}
