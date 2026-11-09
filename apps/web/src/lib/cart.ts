import { useSyncExternalStore } from 'react'

export type CartItem = {
  key: string
  productId: number
  planId: number
  quantity: number
  configOptions: Record<string, string | boolean>
  checkoutConfig: Record<string, string>
  /** Display only; prices always come from the server. */
  name: string
}

const KEY = 'ammonode.cart'
const listeners = new Set<() => void>()
let cache: CartItem[] | null = null

function read(): CartItem[] {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CartItem[]
  } catch {
    cache = []
  }
  return cache
}

function write(items: CartItem[]) {
  cache = items
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {}
  for (const l of listeners) l()
}

export const cart = {
  add: (item: Omit<CartItem, 'key'>) => write([...read(), { ...item, key: crypto.randomUUID() }]),
  remove: (key: string) => write(read().filter((i) => i.key !== key)),
  clear: () => write([]),
  items: read,
}

export function useCart() {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)
}

export const toApiItems = (items: CartItem[]) =>
  items.map(({ productId, planId, quantity, configOptions, checkoutConfig }) => ({
    productId,
    planId,
    quantity,
    configOptions,
    checkoutConfig,
  }))
