import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Copy, Play, RotateCw, Square } from 'lucide-react'
import { createContext, useContext, useState } from 'react'
import { Button, Card, cn, Empty, Pill } from '../../components/ui'
import { Slot } from '../../extensions/registry'
import { api } from '../../lib/api'
import { type ServerDetails, serverCan, useServer, useServerSocket } from '../../lib/server'

type Ctx = { server: ServerDetails; socket: ReturnType<typeof useServerSocket> }
const ServerContext = createContext<Ctx | null>(null)
export const useServerContext = () => useContext(ServerContext)!

const stateTone = { running: 'success', starting: 'warn', stopping: 'warn', offline: 'neutral' } as const

export function PowerButtons({ server, state }: { server: ServerDetails; state: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const power = async (signal: string) => {
    setBusy(signal)
    setError(null)
    try {
      await api.post(`/client/servers/${server.identifier}/power`, { signal })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const stopping = state === 'stopping'
  const disabled = !!server.status
  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      {serverCan(server, 'control.start') && (
        <Button
          size="sm"
          disabled={disabled || state !== 'offline'}
          loading={busy === 'start'}
          onClick={() => power('start')}
        >
          <Play className="size-3.5" /> Start
        </Button>
      )}
      {serverCan(server, 'control.restart') && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || state === 'offline'}
          loading={busy === 'restart'}
          onClick={() => power('restart')}
        >
          <RotateCw className="size-3.5" /> Restart
        </Button>
      )}
      {serverCan(server, 'control.stop') && (
        <Button
          size="sm"
          variant="danger"
          disabled={disabled || state === 'offline'}
          loading={busy === 'stop' || busy === 'kill'}
          onClick={() => power(stopping ? 'kill' : 'stop')}
        >
          <Square className="size-3.5" /> {stopping ? 'Kill' : 'Stop'}
        </Button>
      )}
    </div>
  )
}

const tabs = [
  { to: '', label: 'Console', perm: 'websocket.connect' },
  { to: '/files', label: 'Files', perm: 'file.read' },
  { to: '/startup', label: 'Startup', perm: 'startup.read' },
  { to: '/network', label: 'Network', perm: 'allocation.read' },
  { to: '/settings', label: 'Settings', perm: null },
]

const statusLabel: Record<string, string> = {
  installing: 'Installing',
  install_failed: 'Install failed',
  reinstall_failed: 'Reinstall failed',
  suspended: 'Suspended',
  restoring_backup: 'Restoring backup',
}

export function ServerLayout() {
  const { data: server, error } = useServer()
  const socket = useServerSocket(server?.identifier)
  const qc = useQueryClient()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [copied, setCopied] = useState(false)

  if (error)
    return (
      <Card>
        <Empty title="Server not found">{error.message}</Empty>
      </Card>
    )
  if (!server) return null
  const base = `/server/${server.identifier}`
  const address = server.allocation ? `${server.allocation.ip}:${server.allocation.port}` : '—'
  const state = server.status ? server.status : socket.state

  return (
    <ServerContext.Provider value={{ server, socket }}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-xl font-medium">{server.name}</h2>
              {server.status ? (
                <Pill tone={server.status === 'installing' ? 'warn' : 'danger'} dot>
                  {statusLabel[server.status] ?? server.status}
                </Pill>
              ) : (
                <Pill tone={stateTone[state as keyof typeof stateTone] ?? 'neutral'} dot>
                  {state[0]!.toUpperCase() + state.slice(1)}
                </Pill>
              )}
            </div>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
              onClick={() => {
                navigator.clipboard?.writeText(address)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {address} <Copy className="size-3" /> {copied && <span className="text-success">Copied</span>}
            </button>
          </div>
          <PowerButtons server={server} state={socket.state} />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-3">
          {tabs
            .filter((t) => !t.perm || serverCan(server, t.perm))
            .map((t) => {
              const href = base + t.to
              const active = t.to === '' ? path === base : path.startsWith(href)
              return (
                <Link
                  key={t.to}
                  to={href}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-3 text-[13.5px] whitespace-nowrap',
                    active ? 'border-primary font-medium' : 'border-transparent text-muted hover:text-fg',
                  )}
                >
                  {t.label}
                </Link>
              )
            })}
          <Slot name="server.tabs" props={{ server }} />
        </nav>
      </Card>
      {server.status === 'installing' && (
        <div className="flex items-center justify-between rounded-card border border-line bg-warn-bg px-5 py-3 text-[13px] text-warn">
          This server is being installed. It will be available shortly.
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['server'] })}>
            Refresh
          </Button>
        </div>
      )}
      <Outlet />
    </ServerContext.Provider>
  )
}
