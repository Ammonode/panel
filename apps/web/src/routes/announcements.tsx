import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'
import { Card, CardHeader, Empty, IconTile } from '../components/ui'
import { api, formatDate } from '../lib/api'

type Announcement = {
  id: number
  title: string
  slug: string
  description: string | null
  content: string
  publishedAt: string
}
const useAnnouncements = () =>
  useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<{ data: Announcement[] }>('/announcements'),
    staleTime: 5 * 60_000,
  })

/** Latest announcement on the dashboard. */
export function LatestAnnouncement() {
  const { data } = useAnnouncements()
  const a = data?.data[0]
  if (!a) return null
  return (
    <Link
      to="/announcements"
      className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 hover:border-subtle"
    >
      <IconTile>
        <Megaphone className="size-5" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{a.title}</p>
        <p className="truncate text-[13px] text-muted">{a.description ?? a.content.slice(0, 140)}</p>
      </div>
      <span className="hidden text-xs text-muted sm:block">{formatDate(a.publishedAt)}</span>
    </Link>
  )
}

export function AnnouncementsPage() {
  const { data } = useAnnouncements()
  return (
    <Card>
      <CardHeader title="Announcements" />
      <div className="divide-y divide-line border-t border-line">
        {data?.data.map((a) => (
          <article key={a.id} className="px-5 py-5">
            <p className="text-xs text-muted">{formatDate(a.publishedAt)}</p>
            <h2 className="mt-1 text-[17px] font-medium">{a.title}</h2>
            {/* Plain text with line breaks; no HTML is rendered. */}
            <p className="mt-2 text-[13.5px] whitespace-pre-wrap">{a.content}</p>
          </article>
        ))}
        {data?.data.length === 0 && <Empty title="No announcements" />}
      </div>
    </Card>
  )
}
