import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { Button, Field, Input } from '../components/ui'
import { ApiError, api } from '../lib/api'

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Record<string, unknown>>('/settings/public'),
  })
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold">
          <img src="/favicon.svg" alt="" className="size-7" />
          {String(settings.data?.['app.name'] ?? 'Ammonode').toLowerCase()}
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-medium">{title}</h1>
          <p className="mb-5 text-[13px] text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

const errorOf = (e: unknown) => (e instanceof ApiError ? e : null)

export function LoginPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<'password' | '2fa'>('password')
  const [form, setForm] = useState({ login: '', password: '', code: '' })
  const login = useMutation({
    mutationFn: async () => {
      if (step === '2fa') return api.post('/auth/login/2fa', { code: form.code })
      const res = await api.post<{ twoFactorRequired: boolean }>('/auth/login', {
        login: form.login,
        password: form.password,
      })
      if (res.twoFactorRequired) {
        setStep('2fa')
        return 'pending'
      }
    },
    onSuccess: async (r) => {
      if (r === 'pending') return
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate({ to: '/' })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }
  const err = errorOf(login.error)
  return (
    <AuthShell
      title={step === '2fa' ? 'Two-factor authentication' : 'Sign in'}
      subtitle={
        step === '2fa'
          ? 'Enter the code from your authenticator app or a recovery code.'
          : 'Welcome back! Sign in to your account.'
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {step === 'password' ? (
          <>
            <Field label="Email or username">
              <Input
                autoFocus
                autoComplete="username"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <Field label="Code">
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
        )}
        {err && <p className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">{err.message}</p>}
        <Button type="submit" className="w-full" loading={login.isPending}>
          Continue
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-fg hover:underline">
          Create one
        </Link>
      </p>
    </AuthShell>
  )
}

export function RegisterPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', email: '', password: '' })
  const register = useMutation({
    mutationFn: () => api.post('/auth/register', form),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate({ to: '/' })
    },
  })
  const err = errorOf(register.error)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <AuthShell title="Create an account" subtitle="Get your servers online in minutes.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          register.mutate()
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input value={form.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Last name">
            <Input value={form.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <Field label="Username" error={err?.details?.username}>
          <Input value={form.username} onChange={set('username')} />
        </Field>
        <Field label="Email" error={err?.details?.email}>
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={err?.details?.password}>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
          />
        </Field>
        {err && !err.details && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">{err.message}</p>
        )}
        <Button type="submit" className="w-full" loading={register.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-fg hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
