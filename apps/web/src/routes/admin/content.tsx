import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Card, CardHeader, Empty, Field, Input, Modal, Pill, Toggle } from '../../components/ui'
import { ApiError, api, formatDate } from '../../lib/api'
import { usePublicSettings } from '../../lib/settings'

/** Logo upload used on the admin settings page. */
export function BrandingCard() {
  const qc = useQueryClient()
  const settings = usePublicSettings()
  const input = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('logo', file)
      const res = await fetch('/api/admin/branding/logo', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? 'Upload failed', 'error')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
  const remove = useMutation({
    mutationFn: () => api.delete('/admin/branding/logo'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
  const logo = settings.data?.['app.logo']
  return (
    <Card>
      <CardHeader
        title="Branding"
        subtitle="Shown in the sidebar, sign in pages and emails. PNG, JPG, WebP or SVG up to 1 MB."
      />
      <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
        <div className="grid h-16 w-48 place-items-center rounded-[12px] border border-dashed border-line bg-surface-2">
          {logo ? (
            <img src={logo} alt="Logo" className="max-h-12 max-w-40 object-contain" />
          ) : (
            <span className="text-xs text-muted">No logo</span>
          )}
        </div>
        <Button variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}>
          Upload logo
        </Button>
        {logo && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
        {upload.error && <span className="text-[13px] text-danger">{upload.error.message}</span>}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
      </div>
    </Card>
  )
}

type Announcement = {
  id: number
  title: string
  slug: string
  description: string | null
  content: string
  isActive: boolean
  publishedAt: string | null
  createdAt: string
}
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

export function AdminAnnouncementsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api.get<{ data: Announcement[] }>('/admin/announcements'),
  })
  const [edit, setEdit] = useState<null | {
    id?: number
    title: string
    description: string
    content: string
    isActive: boolean
  }>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
    qc.invalidateQueries({ queryKey: ['announcements'] })
  }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: edit!.title,
        slug: slugify(edit!.title) || `post-${Date.now()}`,
        description: edit!.description || null,
        content: edit!.content,
        isActive: edit!.isActive,
      }
      return edit!.id
        ? api.patch(`/admin/announcements/${edit!.id}`, body)
        : api.post('/admin/announcements', body)
    },
    onSuccess: () => {
      setEdit(null)
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/announcements/${id}`),
    onSuccess: refresh,
  })
  return (
    <Card>
      <CardHeader
        title="Announcements"
        subtitle="The newest one is shown on every customer dashboard."
        action={
          <Button onClick={() => setEdit({ title: '', description: '', content: '', isActive: true })}>
            <Plus className="size-4" /> New announcement
          </Button>
        }
      />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
            <span className="min-w-48 flex-1">
              <span className="font-medium">{a.title}</span>
              <span className="block text-xs text-muted">{a.description}</span>
            </span>
            {!a.isActive && <Pill>Hidden</Pill>}
            <span className="text-xs text-muted">{a.publishedAt && formatDate(a.publishedAt)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEdit({
                  id: a.id,
                  title: a.title,
                  description: a.description ?? '',
                  content: a.content,
                  isActive: a.isActive,
                })
              }
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)}>
              Delete
            </Button>
          </div>
        ))}
        {data?.data.length === 0 && <Empty title="No announcements yet" />}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit announcement' : 'New announcement'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Publish
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3 text-fg">
            <Field label="Title">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Summary" hint="Shown on the dashboard">
              <Input
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </Field>
            <Field label="Content">
              <textarea
                className="h-48 w-full rounded-[10px] border border-line bg-surface p-3 text-sm"
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </Field>
            <span className="flex items-center gap-3 text-[13px]">
              <Toggle
                checked={edit.isActive}
                onChange={(v) => setEdit({ ...edit, isActive: v })}
                label="Visible"
              />{' '}
              Visible to customers
            </span>
            {save.error && <p className="text-danger">{save.error.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  )
}
