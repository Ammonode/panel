export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: Record<string, string>,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.message ?? res.statusText,
      data?.error?.code ?? 'error',
      data?.error?.details,
    )
  }
  return data as T
}

/** Sends/receives plain text (file contents). */
async function text(method: string, path: string, body?: string): Promise<string> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'text/plain' } : undefined,
    body,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(
      res.status,
      data?.error?.message ?? res.statusText,
      data?.error?.code ?? 'error',
      data?.error?.details,
    )
  }
  return res.text()
}

export const api = {
  text,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

export type User = {
  id: number
  uuid: string
  email: string
  username: string
  firstName: string | null
  lastName: string | null
  theme: 'system' | 'light' | 'dark'
  country: string | null
  credits: Record<string, string>
  twoFactorEnabled: boolean
  emailVerified: boolean
  isAdmin: boolean
  permissions: string[]
}

export const can = (user: User | null | undefined, permission: string) =>
  !!user && (user.permissions.includes('*') || user.permissions.includes(permission))

export function formatMoney(amount: string | number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount))
}

export function formatDate(value: string | Date, withTime = false) {
  const d = new Date(value)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return withTime
    ? `${date} | ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : date
}
