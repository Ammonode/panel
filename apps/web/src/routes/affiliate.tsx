import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, Gift, Users } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, Empty, IconTile, Input } from '../components/ui'
import { api, formatDate, formatMoney } from '../lib/api'

type Affiliate = {
  enabled: boolean
  percent: number
  data: null | {
    code: string
    link: string
    visitors: number
    signups: number
    earnings: Record<string, string>
    referrals: { email: string; earnings: Record<string, string>; joinedAt: string }[]
  }
}

export function AffiliatePage() {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const { data } = useQuery({ queryKey: ['affiliate'], queryFn: () => api.get<Affiliate>('/affiliates/me') })
  const join = useMutation({
    mutationFn: () => api.post('/affiliates/me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['affiliate'] }),
  })
  if (!data) return null
  if (!data.data) {
    return (
      <Card>
        <CardHeader
          title="Affiliate program"
          subtitle={
            data.enabled
              ? `Earn ${data.percent}% of every payment from customers you refer, paid as account credit.`
              : 'The affiliate program is not available right now.'
          }
        />
        {data.enabled && (
          <div className="px-5 pb-5">
            <Button loading={join.isPending} onClick={() => join.mutate()}>
              Get my referral link
            </Button>
            {join.error && <p className="mt-2 text-[13px] text-danger">{join.error.message}</p>}
          </div>
        )}
      </Card>
    )
  }
  const a = data.data
  const earned = Object.entries(a.earnings)
  return (
    <>
      <Card>
        <CardHeader
          title="Affiliate program"
          subtitle={`You earn ${data.percent}% of every payment from customers who sign up with your link. Visitors are remembered for 30 days.`}
        />
        <div className="flex gap-2 px-5 pb-5">
          <Input
            className="flex-1"
            readOnly
            value={a.link}
            aria-label="Referral link"
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(a.link)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Copy className="size-4" /> {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
          {[
            [<Eye key="e" className="size-5" />, 'Visitors', a.visitors],
            [<Users key="u" className="size-5" />, 'Sign ups', a.signups],
            [
              <Gift key="g" className="size-5" />,
              'Earned',
              earned.length ? earned.map(([c, v]) => formatMoney(v, c)).join(' · ') : formatMoney(0),
            ],
          ].map(([icon, label, value]) => (
            <div
              key={String(label)}
              className="flex items-center gap-4 rounded-[12px] border border-line bg-surface-2/60 p-4"
            >
              <IconTile>{icon}</IconTile>
              <div>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-xl font-medium">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Referrals" />
        <div className="divide-y divide-line border-t border-line">
          {a.referrals.map((r) => (
            <div
              key={`${r.email}-${r.joinedAt}`}
              className="flex items-center justify-between px-5 py-3 text-[13.5px]"
            >
              <span>{r.email}</span>
              <span className="text-muted">joined {formatDate(r.joinedAt)}</span>
              <span className="font-medium">
                {Object.entries(r.earnings)
                  .map(([c, v]) => formatMoney(v, c))
                  .join(' · ') || formatMoney(0)}
              </span>
            </div>
          ))}
          {a.referrals.length === 0 && (
            <Empty title="No referrals yet">Share your link to start earning.</Empty>
          )}
        </div>
      </Card>
    </>
  )
}
