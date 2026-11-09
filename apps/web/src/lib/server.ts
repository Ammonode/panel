import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

export type ServerDetails = {
  id: number
  uuid: string
  identifier: string
  name: string
  description: string | null
  status: string | null
  isOwner: boolean
  node: string
  sftp: { host: string; port: number; username: string }
  limits: { memory: number; swap: number; disk: number; io: number; cpu: number }
  featureLimits: { databases: number; allocations: number; backups: number }
  allocation: { ip: string; port: number } | null
  egg: { name: string; features: string[]; dockerImages: Record<string, string> } | null
  image: string
  invocation: string
  permissions: string[]
}

export type Stats = {
  memory_bytes: number
  memory_limit_bytes: number
  cpu_absolute: number
  network: { rx_bytes: number; tx_bytes: number }
  uptime: number
  state: string
  disk_bytes: number
}

export function useServerId() {
  return useParams({ strict: false }).id as string
}

export function useServer() {
  const id = useServerId()
  return useQuery({
    queryKey: ['server', id],
    queryFn: () => api.get<{ data: ServerDetails }>(`/client/servers/${id}`).then((r) => r.data),
  })
}

export const serverCan = (s: ServerDetails | undefined, p: string) =>
  !!s && (s.permissions.includes('*') || s.permissions.includes(p))

export function formatBytes(bytes: number, decimals = 1) {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

export function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

type Listener = (event: string, args: string[]) => void

/**
 * Connection to the daemon websocket. Handles auth, token renewal and reconnects.
 */
export function useServerSocket(identifier: string | undefined) {
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<string>('offline')
  const [stats, setStats] = useState<Stats | null>(null)
  const [history, setHistory] = useState<{ cpu: number; mem: number; rx: number; tx: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<Listener>())
  const lastNet = useRef<{ rx: number; tx: number } | null>(null)

  useEffect(() => {
    if (!identifier) return
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const auth = async (socket: WebSocket) => {
      const { data } = await api.get<{ data: { token: string } }>(`/client/servers/${identifier}/websocket`)
      socket.send(JSON.stringify({ event: 'auth', args: [data.token] }))
    }

    const connect = async () => {
      try {
        const { data } = await api.get<{ data: { token: string; socket: string } }>(
          `/client/servers/${identifier}/websocket`,
        )
        if (closed) return
        const socket = new WebSocket(data.socket)
        ws.current = socket
        socket.onopen = () => socket.send(JSON.stringify({ event: 'auth', args: [data.token] }))
        socket.onmessage = (m) => {
          const { event, args = [] } = JSON.parse(String(m.data)) as { event: string; args?: string[] }
          switch (event) {
            case 'auth success':
              attempts = 0
              setConnected(true)
              setError(null)
              socket.send(JSON.stringify({ event: 'send logs' }))
              socket.send(JSON.stringify({ event: 'send stats' }))
              break
            case 'token expiring':
              auth(socket).catch(() => {})
              break
            case 'token expired':
            case 'jwt error':
              setError('Connection to the server was rejected. Reconnecting…')
              socket.close()
              break
            case 'status':
              setState(args[0] ?? 'offline')
              break
            case 'stats': {
              const s = JSON.parse(args[0] ?? '{}') as Stats
              setStats(s)
              if (s.state) setState(s.state)
              const prev = lastNet.current
              lastNet.current = { rx: s.network.rx_bytes, tx: s.network.tx_bytes }
              setHistory((h) =>
                [
                  ...h,
                  {
                    cpu: s.cpu_absolute,
                    mem: s.memory_bytes,
                    rx: prev ? Math.max(0, s.network.rx_bytes - prev.rx) : 0,
                    tx: prev ? Math.max(0, s.network.tx_bytes - prev.tx) : 0,
                  },
                ].slice(-30),
              )
              break
            }
          }
          for (const l of listeners.current) l(event, args)
        }
        socket.onclose = () => {
          setConnected(false)
          if (!closed) retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempts++))
        }
      } catch {
        setError('Could not connect to the node. Retrying…')
        if (!closed) retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempts++))
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      ws.current?.close()
    }
  }, [identifier])

  const send = useCallback((event: string, ...args: string[]) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ event, args }))
  }, [])

  const on = useCallback((l: Listener) => {
    listeners.current.add(l)
    return () => {
      listeners.current.delete(l)
    }
  }, [])

  return { connected, state, stats, history, error, send, on }
}
