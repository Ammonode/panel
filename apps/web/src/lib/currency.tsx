import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { api } from './api'

const KEY = 'ammonode.currency'
const listeners = new Set<() => void>()
const read = () => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Currency the customer picked in the store ('' = shop default). */
export function useCurrency(): [string, (code: string) => void] {
  const code = useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)
  const set = (c: string) => {
    try {
      localStorage.setItem(KEY, c)
    } catch {}
    for (const l of listeners) l()
  }
  return [code, set]
}

export const currencyQuery = (code: string) => (code ? `?currency=${encodeURIComponent(code)}` : '')

export function CurrencySelect() {
  const [code, setCode] = useCurrency()
  const { data } = useQuery({
    queryKey: ['currencies'],
    queryFn: () =>
      api.get<{ data: { code: string; isDefault: boolean }[] }>('/store/currencies').then((r) => r.data),
    staleTime: 300_000,
  })
  if (!data || data.length < 2) return null
  const value = code || data.find((c) => c.isDefault)?.code || ''
  return (
    <select
      aria-label="Currency"
      className="h-10 rounded-[10px] border border-line bg-surface px-3 text-sm"
      value={value}
      onChange={(e) => setCode(e.target.value)}
    >
      {data.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code}
        </option>
      ))}
    </select>
  )
}
