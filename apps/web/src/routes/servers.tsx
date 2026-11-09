import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Gamepad2 } from 'lucide-react'
import { Card, CardHeader, Empty, IconTile, Pill } from '../components/ui'
import { api } from '../lib/api'

type Server = {
  id: number
  uuidShort: string
  name: string
  status: string | null
  memory: number
  disk: number
  cpu: number
}

export function ServersPage() {
  const { data } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get<{ data: Server[] }>('/client/servers'),
  })
  return (
    <Card>
      <CardHeader title="Your servers" />
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
        {data?.data.map((s) => (
          <Link
            key={s.id}
            to="/server/$id"
            params={{ id: s.uuidShort }}
            className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2 p-4 hover:border-subtle"
          >
            <IconTile>
              <Gamepad2 className="size-5" />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                {s.memory} MiB · {Math.round(s.disk / 1024)} GiB · {s.cpu || '∞'}% CPU
              </p>
            </div>
            {s.status ? (
              <Pill tone="warn">{s.status}</Pill>
            ) : (
              <Pill tone="success" dot>
                Ready
              </Pill>
            )}
          </Link>
        ))}
      </div>
      {data?.data.length === 0 && (
        <Empty title="No servers yet">Order a plan to get your first server online.</Empty>
      )}
    </Card>
  )
}

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <Empty title="Nothing here yet" />
    </Card>
  )
}
