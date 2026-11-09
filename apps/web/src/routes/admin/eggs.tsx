import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Card, CardHeader, Empty, Input, Pill } from '../../components/ui'
import { api } from '../../lib/api'

type Nest = {
  id: number
  name: string
  description: string | null
  eggs: { id: number; name: string; author: string; sourceUrl: string | null }[]
}
type CatalogEgg = {
  id: string
  name: string
  category: string
  rawUrl: string
  path: string
  repo: string
  importedEggId: number | null
}

export function AdminEggsPage() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [nestId, setNestId] = useState<number | null>(null)
  const nests = useQuery({
    queryKey: ['admin', 'nests'],
    queryFn: () => api.get<{ data: Nest[] }>('/admin/nests'),
  })
  const catalog = useQuery({
    queryKey: ['admin', 'egg-catalog'],
    queryFn: () => api.get<{ data: CatalogEgg[] }>('/admin/egg-catalog'),
    staleTime: 300_000,
  })
  const target = nestId ?? nests.data?.data[0]?.id ?? null

  const importEgg = useMutation({
    mutationFn: (egg: CatalogEgg) =>
      api.post(`/admin/nests/${target}/import`, {
        url: egg.rawUrl,
        updateEggId: egg.importedEggId ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'nests'] })
      qc.invalidateQueries({ queryKey: ['admin', 'egg-catalog'] })
    },
  })

  const filtered = useMemo(() => {
    const term = q.toLowerCase()
    return (catalog.data?.data ?? [])
      .filter((e) => !term || `${e.name} ${e.category}`.toLowerCase().includes(term))
      .slice(0, 200)
  }, [catalog.data, q])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader title="Nests" subtitle="Eggs grouped by nest, exactly like Pterodactyl." />
        <div className="space-y-3 px-5 pb-5">
          {nests.data?.data.map((n) => (
            <div key={n.id} className="rounded-[12px] border border-line bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{n.name}</p>
                <span className="text-xs text-muted">{n.eggs.length} eggs</span>
              </div>
              {n.description && <p className="mt-0.5 text-xs text-muted">{n.description}</p>}
              {!!n.eggs.length && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {n.eggs.map((e) => (
                    <li key={e.id}>
                      <Pill tone="info">{e.name}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Official egg catalog"
          subtitle={
            <>
              All eggs from{' '}
              <a className="underline" href="https://eggs.pterodactyl.io/" target="_blank" rel="noreferrer">
                eggs.pterodactyl.io
              </a>
              , ready to import.
            </>
          }
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => api.get('/admin/egg-catalog?refresh=1').then(() => catalog.refetch())}
            >
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          }
        />
        <div className="flex flex-wrap gap-3 px-5 pb-4">
          <Input
            className="min-w-48 flex-1"
            icon={<Search className="size-4" />}
            placeholder={`Search ${catalog.data?.data.length ?? ''} eggs`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="h-10 rounded-[10px] border border-line bg-surface px-3 text-sm"
            value={target ?? ''}
            onChange={(e) => setNestId(Number(e.target.value))}
            aria-label="Import into nest"
          >
            {nests.data?.data.map((n) => (
              <option key={n.id} value={n.id}>
                Import into: {n.name}
              </option>
            ))}
          </select>
        </div>
        {importEgg.error && (
          <p className="mx-5 mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">
            {importEgg.error.message}
          </p>
        )}
        <div className="max-h-[640px] divide-y divide-line overflow-y-auto border-t border-line">
          {catalog.isLoading && <Empty title="Loading catalog…" />}
          {catalog.error && <Empty title="Could not load the catalog">{catalog.error.message}</Empty>}
          {filtered.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{e.name}</p>
                <p className="truncate text-[11px] text-muted">{e.category}</p>
              </div>
              <a
                href={e.rawUrl}
                target="_blank"
                rel="noreferrer"
                className="text-subtle hover:text-fg"
                aria-label="View JSON"
              >
                <ExternalLink className="size-4" />
              </a>
              <Button
                size="sm"
                variant={e.importedEggId ? 'outline' : 'primary'}
                loading={importEgg.isPending && importEgg.variables?.id === e.id}
                onClick={() => importEgg.mutate(e)}
              >
                <Download className="size-3.5" /> {e.importedEggId ? 'Update' : 'Import'}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
