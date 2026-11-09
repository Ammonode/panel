import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, File, FilePlus, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, cn, Empty, Input, Modal } from '../../components/ui'
import { api, formatDate } from '../../lib/api'
import { formatBytes, serverCan } from '../../lib/server'
import { useServerContext } from './layout'

type FileEntry = {
  name: string
  size: number
  directory: boolean
  file: boolean
  mime: string
  modified: string
  mode_bits: string
}

const join = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`

function Editor({ path, onClose }: { path: string; onClose: () => void }) {
  const { server } = useServerContext()
  const isNew = path.endsWith('/')
  const [name, setName] = useState(isNew ? '' : path)
  const [content, setContent] = useState<string | null>(isNew ? '' : null)
  const qc = useQueryClient()
  useQuery({
    queryKey: ['file', server.identifier, path],
    enabled: !isNew,
    queryFn: async () => {
      const text = await api.text(
        'GET',
        `/client/servers/${server.identifier}/files/contents?file=${encodeURIComponent(path)}`,
      )
      setContent(text)
      return text
    },
    staleTime: 0,
    gcTime: 0,
  })
  const target = isNew ? join(path, name) : path
  const save = useMutation({
    mutationFn: () =>
      api.text(
        'POST',
        `/client/servers/${server.identifier}/files/write?file=${encodeURIComponent(target)}`,
        content ?? '',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', server.identifier] })
      if (isNew) onClose()
    },
  })
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {isNew ? (
          <Input
            className="min-w-60 flex-1"
            placeholder="file-name.txt"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="File name"
          />
        ) : (
          <code className="flex-1 truncate text-[13px]">{path}</code>
        )}
        {save.isSuccess && !isNew && <span className="text-xs text-success">Saved</span>}
        {save.error && <span className="text-xs text-danger">{save.error.message}</span>}
        {serverCan(server, isNew ? 'file.create' : 'file.update') && (
          <Button
            size="sm"
            loading={save.isPending}
            disabled={content === null || (isNew && !name)}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Create file' : 'Save'}
          </Button>
        )}
      </div>
      {content === null ? (
        <Empty title="Loading…" />
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              save.mutate()
            }
          }}
          spellCheck={false}
          aria-label="File contents"
          className="block h-[560px] w-full resize-y rounded-b-card bg-[#0f1117] p-4 font-mono text-[12.5px] leading-relaxed text-[#d7dae0] outline-none"
        />
      )}
    </Card>
  )
}

export function FilesPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const [dir, setDir] = useState('/')
  const [editing, setEditing] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [dialog, setDialog] = useState<
    null | { type: 'folder' } | { type: 'rename'; from: string } | { type: 'delete' }
  >(null)
  const [value, setValue] = useState('')
  const base = `/client/servers/${server.identifier}/files`

  const files = useQuery({
    queryKey: ['files', server.identifier, dir],
    queryFn: () =>
      api.get<{ data: FileEntry[] }>(`${base}/list?directory=${encodeURIComponent(dir)}`).then((r) => r.data),
  })
  const refresh = () => {
    setSelected([])
    setDialog(null)
    qc.invalidateQueries({ queryKey: ['files', server.identifier] })
  }
  const action = useMutation({
    mutationFn: async () => {
      if (dialog?.type === 'folder') await api.post(`${base}/create-folder`, { root: dir, name: value })
      if (dialog?.type === 'rename')
        await api.put(`${base}/rename`, { root: dir, files: [{ from: dialog.from, to: value }] })
      if (dialog?.type === 'delete') await api.post(`${base}/delete`, { root: dir, files: selected })
    },
    onSuccess: refresh,
  })
  const download = async (name: string) => {
    const { data } = await api.get<{ data: { url: string } }>(
      `${base}/download?file=${encodeURIComponent(join(dir, name))}`,
    )
    window.location.href = data.url
  }

  if (editing) return <Editor path={editing} onClose={() => setEditing(null)} />

  const crumbs = dir.split('/').filter(Boolean)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <nav className="flex flex-wrap items-center gap-1 text-[13.5px]" aria-label="Path">
          <button type="button" className="text-muted hover:text-fg" onClick={() => setDir('/')}>
            container
          </button>
          {crumbs.map((c, i) => (
            <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-1">
              <span className="text-subtle">/</span>
              <button
                type="button"
                className={cn(i === crumbs.length - 1 ? 'font-medium' : 'text-muted hover:text-fg')}
                onClick={() => setDir(`/${crumbs.slice(0, i + 1).join('/')}`)}
              >
                {c}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {!!selected.length && serverCan(server, 'file.delete') && (
            <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'delete' })}>
              <Trash2 className="size-3.5" /> Delete ({selected.length})
            </Button>
          )}
          {serverCan(server, 'file.create') && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setValue('')
                  setDialog({ type: 'folder' })
                }}
              >
                <FolderPlus className="size-3.5" /> New folder
              </Button>
              <Button size="sm" onClick={() => setEditing(`${dir.replace(/\/$/, '')}/`)}>
                <FilePlus className="size-3.5" /> New file
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="divide-y divide-line border-t border-line">
        {dir !== '/' && (
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13.5px] hover:bg-surface-2"
            onClick={() => setDir(dir.split('/').slice(0, -1).join('/') || '/')}
          >
            <Folder className="size-4 text-subtle" /> ..
          </button>
        )}
        {files.isLoading && <Empty title="Loading…" />}
        {files.error && <Empty title="Could not load files">{files.error.message}</Empty>}
        {files.data?.length === 0 && <Empty title="This folder is empty" />}
        {files.data?.map((f) => (
          <div
            key={f.name}
            className="group flex items-center gap-3 px-5 py-2 text-[13.5px] hover:bg-surface-2"
          >
            <input
              type="checkbox"
              aria-label={`Select ${f.name}`}
              checked={selected.includes(f.name)}
              onChange={(e) =>
                setSelected((s) => (e.target.checked ? [...s, f.name] : s.filter((x) => x !== f.name)))
              }
            />
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() =>
                f.directory
                  ? setDir(join(dir, f.name))
                  : f.size < 10 * 1024 * 1024 && f.mime.startsWith('text')
                    ? setEditing(join(dir, f.name))
                    : download(f.name)
              }
            >
              {f.directory ? (
                <Folder className="size-4 shrink-0 text-accent" />
              ) : (
                <File className="size-4 shrink-0 text-subtle" />
              )}
              <span className="truncate">{f.name}</span>
            </button>
            <span className="hidden w-24 text-right text-xs text-muted sm:block">
              {f.directory ? '' : formatBytes(f.size)}
            </span>
            <span className="hidden w-32 text-right text-xs text-muted md:block">
              {formatDate(f.modified)}
            </span>
            <span className="flex w-16 justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              {serverCan(server, 'file.update') && (
                <button
                  type="button"
                  aria-label={`Rename ${f.name}`}
                  className="rounded p-1 hover:bg-surface"
                  onClick={() => {
                    setValue(f.name)
                    setDialog({ type: 'rename', from: f.name })
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              {f.file && (
                <button
                  type="button"
                  aria-label={`Download ${f.name}`}
                  className="rounded p-1 hover:bg-surface"
                  onClick={() => download(f.name)}
                >
                  <Download className="size-3.5" />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          dialog?.type === 'folder' ? 'New folder' : dialog?.type === 'rename' ? 'Rename' : 'Delete files'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.type === 'delete' ? 'danger' : 'primary'}
              loading={action.isPending}
              onClick={() => action.mutate()}
            >
              {dialog?.type === 'delete' ? 'Delete' : 'Save'}
            </Button>
          </>
        }
      >
        {dialog?.type === 'delete' ? (
          <p>Delete {selected.length} item(s)? This cannot be undone.</p>
        ) : (
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && action.mutate()}
            aria-label="Name"
          />
        )}
        {action.error && <p className="mt-2 text-danger">{action.error.message}</p>}
      </Modal>
    </Card>
  )
}
