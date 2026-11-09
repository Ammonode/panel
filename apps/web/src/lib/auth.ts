import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type User } from './api'

type Me = { user: User | null; twoFactorPending: boolean; impersonating: boolean }

export const meQuery = { queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000 }

export function useMe() {
  return useQuery(meQuery)
}

export function useUser() {
  return useQuery(meQuery).data?.user ?? null
}

export function useRefreshMe() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['me'] })
}
