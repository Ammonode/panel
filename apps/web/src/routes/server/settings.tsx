import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill } from '../../components/ui'
import { api } from '../../lib/api'
import { serverCan } from '../../lib/server'
import { useServerContext } from './layout'

export function NetworkPage() {
  const { server } = useServerContext()
  const { data } = useQuery({
    queryKey: ['allocations', server.identifier],
    queryFn: () =>
      api.get<{ data: { id: number; ip: string; port: number; notes: string | null; isDefault: boolean }[] }>(
        `/client/servers/${server.identifier}/network/allocations`,
      ),
  })
  return (
    <Card>
      <CardHeader title="Allocations" subtitle="Addresses players use to connect to this server." />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <div key={a.id} className="flex items-center gap-4 px-5 py-3 text-[13.5px]">
            <code className="flex-1">
              {a.ip}:{a.port}
            </code>
            <span className="text-xs text-muted">{a.notes}</span>
            {a.isDefault && <Pill tone="info">Primary</Pill>}
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
