import { ChevronRight, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, Card, IconTile, Modal, Sparkline } from '../../components/ui'
import { Slot } from '../../extensions/registry'
import { ansiToReact, stripAnsi } from '../../lib/ansi'
import { api } from '../../lib/api'
import { formatBytes, formatUptime, serverCan } from '../../lib/server'
import { useServerContext } from './layout'

type Line = { id: number; text: string; kind: 'out' | 'daemon' | 'install' }
let lineId = 0

function StatCard({
  icon,
  label,
  value,
  sub,
  values,
  max,
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  values: number[]
  max?: number
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <IconTile>{icon}</IconTile>
        <div className="min-w-0">
          <p className="text-xs text-muted">{label}</p>
          <p className="truncate text-[15px] font-medium">
            {value} {sub && <span className="text-xs font-normal text-muted">{sub}</span>}
          </p>
        </div>
      </div>
      <Sparkline values={values} max={max} className="mt-3 text-accent" />
    </Card>
  )
}

export function ConsolePage() {
  const { server, socket } = useServerContext()
  const [lines, setLines] = useState<Line[]>([])
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [eula, setEula] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const stateRef = useRef(socket.state)
  stateRef.current = socket.state

  useEffect(
    () =>
      socket.on((event, args) => {
        if (event === 'auth success') setLines([])
        const kind =
          event === 'console output'
            ? 'out'
            : event === 'install output'
              ? 'install'
              : event === 'daemon message'
                ? 'daemon'
                : null
        if (!kind) return
        const text = args[0] ?? ''
        if (
          kind === 'out' &&
          stateRef.current !== 'running' &&
          server.egg?.features.includes('eula') &&
          /agree to the EULA/i.test(stripAnsi(text))
        )
          setEula(true)
        setLines((l) => [...l, { id: lineId++, text, kind: kind as Line['kind'] }].slice(-500))
      }),
    [socket.on, server.egg],
  )

  // Keep the newest output in view unless the user scrolled up.
  useEffect(() => {
    if (lines.length && stick.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight
  }, [lines])

  const submit = () => {
    if (!command.trim()) return
    socket.send('send command', command)
    setHistory((h) => [command, ...h.filter((x) => x !== command)].slice(0, 50))
    setHistoryIndex(-1)
    setCommand('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const i = Math.min(history.length - 1, historyIndex + 1)
      setHistoryIndex(i)
      setCommand(history[i]!)
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const i = historyIndex - 1
      setHistoryIndex(Math.max(-1, i))
      setCommand(i < 0 ? '' : history[i]!)
    }
  }

  const acceptEula = async () => {
    setAccepting(true)
    try {
      await api.text(
        'POST',
        `/client/servers/${server.identifier}/files/write?file=%2Feula.txt`,
        'eula=true\n',
      )
      await api.post(`/client/servers/${server.identifier}/power`, { signal: 'start' })
      setEula(false)
    } finally {
      setAccepting(false)
    }
  }

  const s = socket.stats
  const memLimit = server.limits.memory * 1024 * 1024
  const h = socket.history

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>Console</span>
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${socket.connected ? 'bg-success' : 'bg-danger'}`} />
              {socket.connected ? 'Connected' : (socket.error ?? 'Connecting…')}
            </span>
          </div>
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
            className="h-[460px] overflow-y-auto bg-[#0f1117] px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-[#d7dae0]"
          >
            {lines.map((l) => (
              <div key={l.id} className="break-words whitespace-pre-wrap">
                {l.kind === 'daemon' ? (
                  <span className="text-[#e8c35a]">
                    {l.text.startsWith('[') ? l.text : `[Ammonode Daemon]: ${l.text}`}
                  </span>
                ) : (
                  ansiToReact(l.text)
                )}
              </div>
            ))}
            {!lines.length && <p className="text-[#6b7080]">No output yet.</p>}
          </div>
          {serverCan(server, 'control.console') && (
            <div className="flex items-center gap-2 border-t border-[#272b36] bg-[#0f1117] px-4 py-2">
              <ChevronRight className="size-4 text-[#6b7080]" />
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={onKey}
                disabled={socket.state === 'offline'}
                placeholder={socket.state === 'offline' ? 'Server is offline' : 'Type a command…'}
                aria-label="Console command"
                className="h-9 flex-1 bg-transparent font-mono text-[13px] text-[#d7dae0] outline-none placeholder:text-[#6b7080]"
              />
            </div>
          )}
        </Card>

        <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <StatCard
            icon={<Cpu className="size-5" />}
            label="CPU"
            value={`${(s?.cpu_absolute ?? 0).toFixed(1)}%`}
            sub={server.limits.cpu ? `/ ${server.limits.cpu}%` : '/ ∞'}
            values={h.map((x) => x.cpu)}
            max={server.limits.cpu || 100}
          />
          <StatCard
            icon={<MemoryStick className="size-5" />}
            label="Memory"
            value={formatBytes(s?.memory_bytes ?? 0)}
            sub={server.limits.memory ? `/ ${formatBytes(memLimit)}` : '/ ∞'}
            values={h.map((x) => x.mem)}
            max={memLimit || undefined}
          />
          <StatCard
            icon={<HardDrive className="size-5" />}
            label="Disk"
            value={formatBytes(s?.disk_bytes ?? 0)}
            sub={server.limits.disk ? `/ ${formatBytes(server.limits.disk * 1024 * 1024)}` : '/ ∞'}
            values={[]}
          />
          <StatCard
            icon={<Network className="size-5" />}
            label="Network"
            value={`↓ ${formatBytes(h.at(-1)?.rx ?? 0)}/s`}
            sub={`↑ ${formatBytes(h.at(-1)?.tx ?? 0)}/s`}
            values={h.map((x) => x.rx + x.tx)}
          />
          {s && socket.state !== 'offline' && (
            <p className="px-1 text-xs text-muted">Uptime {formatUptime(s.uptime)}</p>
          )}
          <Slot name="server.console.sidebar" props={{ server }} />
        </div>
      </div>

      <Modal
        open={eula}
        onClose={() => setEula(false)}
        title="Accept the Minecraft EULA"
        footer={
          <>
            <Button variant="outline" onClick={() => setEula(false)}>
              Cancel
            </Button>
            <Button loading={accepting} onClick={acceptEula}>
              I accept
            </Button>
          </>
        }
      >
        By pressing "I accept" you agree to the{' '}
        <a
          href="https://www.minecraft.net/eula"
          target="_blank"
          rel="noreferrer"
          className="text-fg underline"
        >
          Minecraft EULA
        </a>
        . The server will start right after.
      </Modal>
    </>
  )
}
