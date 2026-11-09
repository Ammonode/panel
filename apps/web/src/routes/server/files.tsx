import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowLeft,
  Download,
  File,
  FileArchive,
  FilePlus,
  Folder,
  FolderPlus,
  Link2,
  PackageOpen,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'
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

const isArchive = (name: string) => /\.(zip|tar|tar\.gz|tgz)$/i.test(name)

type Dialog =
  | { type: 'folder' }
  | { type: 'rename'; from: string }
  | { type: 'delete' }
  | { type: 'chmod'; file: string; mode: string }
  | { type: 'pull' }

export function FilesPage() {
  const { server } = useServerContext()
  const qc = useQueryClient()
  const [dir, setDir] = useState('/')
  const [editing, setEditing] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [value, setValue] = useState('')
  const [extra, setExtra] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
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
      if (dialog?.type === 'chmod')
        await api.post(`${base}/chmod`, { root: dir, files: [{ file: dialog.file, mode: value }] })
      if (dialog?.type === 'pull')
        await api.post(`${base}/pull`, { url: value, directory: dir, filename: extra || undefined })
    },
    onSuccess: refresh,
  })
  const archive = useMutation({
    mutationFn: () => api.post(`${base}/compress`, { root: dir, files: selected }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  })
  const extract = useMutation({
    mutationFn: (file: string) => api.post(`${base}/decompress`, { root: dir, file }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  })
  const download = async (name: string) => {
    const { data } = await api.get<{ data: { url: string } }>(
      `${base}/download?file=${encodeURIComponent(join(dir, name))}`,
    )
    window.location.href = data.url
  }

  // Uploads go straight from the browser to the node.
  const upload = async (list: FileList | File[]) => {
    const items = [...list]
    if (!items.length) return
    setError(null)
    try {
      const { data } = await api.get<{ data: { url: string } }>(`${base}/upload`)
      for (const [i, file] of items.entries()) {
        setUploading(`Uploading ${file.name} (${i + 1}/${items.length})`)
        const form = new FormData()
        form.append('files', file)
        const res = await fetch(`${data.url}&directory=${encodeURIComponent(dir)}`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error?.message ?? `Upload of ${file.name} failed`)
        }
      }
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(null)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (serverCan(server, 'file.create')) upload(e.dataTransfer.files)
  }

  if (editing) return <Editor path={editing} onClose={() => setEditing(null)} />

  const crumbs = dir.split('/').filter(Boolean)
  const openDialog = (d: Dialog, v = '', x = '') => {
    action.reset()
    setValue(v)
    setExtra(x)
    setDialog(d)
  }
  const titles: Record<Dialog['type'], string> = {
    folder: 'New folder',
    rename: 'Rename',
    delete: 'Delete files',
    chmod: 'Permissions',
    pull: 'Download from URL',
  }

  return (
    <Card className={cn(dragging && 'outline-2 outline-dashed outline-accent')}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
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
            {!!selected.length && serverCan(server, 'file.archive') && (
              <Button
                size="sm"
                variant="outline"
                loading={archive.isPending}
                onClick={() => archive.mutate()}
              >
                <Archive className="size-3.5" /> Archive ({selected.length})
              </Button>
            )}
            {!!selected.length && serverCan(server, 'file.delete') && (
              <Button size="sm" variant="danger" onClick={() => openDialog({ type: 'delete' })}>
                <Trash2 className="size-3.5" /> Delete ({selected.length})
              </Button>
            )}
            {serverCan(server, 'file.create') && (
              <>
                <Button size="sm" variant="outline" onClick={() => openDialog({ type: 'pull' })}>
                  <Link2 className="size-3.5" /> From URL
                </Button>
                <Button size="sm" variant="outline" onClick={() => openDialog({ type: 'folder' })}>
                  <FolderPlus className="size-3.5" /> New folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={!!uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="size-3.5" /> Upload
                </Button>
                <Button size="sm" onClick={() => setEditing(`${dir.replace(/\/$/, '')}/`)}>
                  <FilePlus className="size-3.5" /> New file
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => e.target.files && upload(e.target.files)}
                />
              </>
            )}
          </div>
        </div>
        {(uploading || error) && (
          <p
            className={cn(
              'mx-5 mb-3 rounded-lg px-3 py-2 text-[13px]',
              error ? 'bg-danger-bg text-danger' : 'bg-info-bg text-info',
            )}
          >
            {error ?? uploading}
            {error && (
              <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
                Dismiss
              </button>
            )}
          </p>
        )}
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
          {files.data?.length === 0 && (
            <Empty title="This folder is empty">Drop files here to upload them.</Empty>
          )}
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
                ) : isArchive(f.name) ? (
                  <FileArchive className="size-4 shrink-0 text-subtle" />
                ) : (
                  <File className="size-4 shrink-0 text-subtle" />
                )}
                <span className="truncate">{f.name}</span>
              </button>
              <span className="hidden w-12 text-right font-mono text-xs text-subtle lg:block">
                {f.mode_bits}
              </span>
              <span className="hidden w-24 text-right text-xs text-muted sm:block">
                {f.directory ? '' : formatBytes(f.size)}
              </span>
              <span className="hidden w-32 text-right text-xs text-muted md:block">
                {formatDate(f.modified)}
              </span>
              <span className="flex w-24 justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                {f.file && isArchive(f.name) && serverCan(server, 'file.archive') && (
                  <button
                    type="button"
                    aria-label={`Extract ${f.name}`}
                    title="Extract here"
                    className="rounded p-1 hover:bg-surface"
                    onClick={() => extract.mutate(f.name)}
                  >
                    <PackageOpen className="size-3.5" />
                  </button>
                )}
                {serverCan(server, 'file.update') && (
                  <button
                    type="button"
                    aria-label={`Rename ${f.name}`}
                    title="Rename"
                    className="rounded p-1 hover:bg-surface"
                    onClick={() => openDialog({ type: 'rename', from: f.name }, f.name)}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
                {serverCan(server, 'file.update') && (
                  <button
                    type="button"
                    aria-label={`Permissions of ${f.name}`}
                    title="Permissions"
                    className="rounded p-1 font-mono text-[10px] hover:bg-surface"
                    onClick={() => openDialog({ type: 'chmod', file: f.name, mode: '' }, octal(f.mode_bits))}
                  >
                    chmod
                  </button>
                )}
                {f.file && (
                  <button
                    type="button"
                    aria-label={`Download ${f.name}`}
                    title="Download"
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
      </div>

      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog ? titles[dialog.type] : ''}
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
              {dialog?.type === 'delete' ? 'Delete' : dialog?.type === 'pull' ? 'Download' : 'Save'}
            </Button>
          </>
        }
      >
        {dialog?.type === 'delete' ? (
          <p>Delete {selected.length} item(s)? This cannot be undone.</p>
        ) : (
          <div className="space-y-3">
            <Input
              autoFocus
              value={value}
              placeholder={
                dialog?.type === 'pull'
                  ? 'https://example.com/plugin.jar'
                  : dialog?.type === 'chmod'
                    ? '644'
                    : undefined
              }
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && action.mutate()}
              aria-label={dialog?.type === 'pull' ? 'URL' : 'Name'}
            />
            {dialog?.type === 'pull' && (
              <Input
                value={extra}
                placeholder="File name (optional)"
                onChange={(e) => setExtra(e.target.value)}
                aria-label="File name"
              />
            )}
            {dialog?.type === 'chmod' && (
              <p className="text-xs">Octal mode, e.g. 644 for files or 755 for folders and scripts.</p>
            )}
          </div>
        )}
        {action.error && <p className="mt-2 text-danger">{action.error.message}</p>}
      </Modal>
    </Card>
  )
}

/** "rw-r--r--" -> "644" */
function octal(bits: string) {
  const s = bits.slice(-9)
  if (s.length !== 9) return '644'
  return [0, 3, 6]
    .map((i) => (s[i] === 'r' ? 4 : 0) + (s[i + 1] === 'w' ? 2 : 0) + (s[i + 2] === 'x' ? 1 : 0))
    .join('')
}
