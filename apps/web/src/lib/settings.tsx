import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type PublicSettings = {
  'app.name': string
  'app.logo': string | null
  'auth.registration': boolean
  'tickets.enabled': boolean
  'app.support_email': string
  'billing.credits_enabled': boolean
  'affiliates.enabled': boolean
}

export const usePublicSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<PublicSettings>('/settings/public'),
    staleTime: 5 * 60_000,
  })

/** Logo + name. With a custom logo only the image is shown. */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { data } = usePublicSettings()
  const name = data?.['app.name'] ?? 'Ammonode'
  if (data?.['app.logo'])
    return (
      <img
        src={data['app.logo']}
        alt={name}
        className={size === 'lg' ? 'h-9 max-w-52 object-contain' : 'h-7 max-w-44 object-contain'}
      />
    )
  return (
    <>
      <img src="/favicon.svg" alt="" className={size === 'lg' ? 'size-7' : 'size-6'} />
      {name.toLowerCase()}
    </>
  )
}
