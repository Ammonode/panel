import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { Button, Field, Input } from '../components/ui'
import { ApiError, api } from '../lib/api'

export function AuthShell({
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
        {step === 'password' && (
          <Link to="/forgot-password" className="block text-center text-[13px] text-muted hover:text-fg">
            Forgot your password?
          </Link>
        )}
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

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const send = useMutation({ mutationFn: () => api.post('/auth/forgot-password', { email }) })
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your email and we will send you a reset link.">
      {send.isSuccess ? (
        <p className="rounded-lg bg-success-bg px-3 py-3 text-[13px] text-success">
          If an account exists for {email}, a reset link is on its way. It is valid for one hour.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate()
          }}
        >
          <Field label="Email">
            <Input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {send.error && <p className="text-[13px] text-danger">{send.error.message}</p>}
          <Button type="submit" className="w-full" loading={send.isPending}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-[13px] text-muted">
        <Link to="/login" className="font-medium text-fg hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const reset = useMutation({
    mutationFn: () => {
      if (password !== confirm) throw new Error('The passwords do not match.')
      return api.post('/auth/reset-password', { token, password })
    },
    onSuccess: () => setTimeout(() => navigate({ to: '/login' }), 1500),
  })
  return (
    <AuthShell title="Choose a new password" subtitle="You will be signed out of every other device.">
      {reset.isSuccess ? (
        <p className="rounded-lg bg-success-bg px-3 py-3 text-[13px] text-success">
          Your password was changed. Taking you to sign in…
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            reset.mutate()
          }}
        >
          <Field label="New password" hint="At least 8 characters">
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {(reset.error || !token) && (
            <p className="text-[13px] text-danger">
              {reset.error?.message ?? 'This link is missing its token.'}
            </p>
          )}
          <Button type="submit" className="w-full" loading={reset.isPending} disabled={!token}>
            Change password
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export function VerifyEmailPage() {
  const qc = useQueryClient()
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const verify = useMutation({
    mutationFn: () => api.post('/auth/verify-email', { token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  useEffect(() => {
    if (token && verify.isIdle) verify.mutate()
  }, [token, verify])
  return (
    <AuthShell title="Email confirmation" subtitle="">
      {verify.isPending && <p className="text-[13px] text-muted">Confirming…</p>}
      {verify.isSuccess && (
        <p className="rounded-lg bg-success-bg px-3 py-3 text-[13px] text-success">
          Thanks, your email address is confirmed.
        </p>
      )}
      {(verify.error || !token) && (
        <p className="rounded-lg bg-danger-bg px-3 py-3 text-[13px] text-danger">
          {verify.error?.message ?? 'This link is missing its token.'}
        </p>
      )}
      <p className="mt-5 text-center text-[13px]">
        <Link to="/" className="font-medium hover:underline">
          Go to the dashboard
        </Link>
      </p>
    </AuthShell>
  )
}
