import { clsx } from 'clsx'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

export const cn = clsx

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-card border border-line bg-surface', className)}>{children}</section>
}

export function CardHeader({
  title,
  action,
  subtitle,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
      <div>
        <h2 className="text-[17px] font-medium">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Footer link row at the bottom of a card ("See all", "Upgrade now"). */
export function CardFooter({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 border-t border-line py-3 text-[13px] font-medium hover:bg-surface-2 rounded-b-card"
    >
      {children}
    </button>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-primary text-primary-fg hover:opacity-90',
        variant === 'outline' && 'border border-line bg-surface hover:bg-surface-2',
        variant === 'ghost' && 'hover:bg-surface-2',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
})

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }
>(function Input({ className, icon, ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      {icon && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm placeholder:text-subtle outline-none focus:border-accent focus:ring-2 focus:ring-accent/15',
          icon ? 'pl-10' : undefined,
        )}
        {...props}
      />
    </div>
  )
})

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the control passed as children
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </label>
  )
}

const pillTones = {
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
  neutral: 'bg-neutral-bg text-neutral',
} as const

export function Pill({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: keyof typeof pillTones
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
        pillTones[tone],
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Gradient icon tile used on stat cards. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <div className="icon-tile grid size-11 shrink-0 place-items-center rounded-[10px] text-white shadow-sm">
      {children}
    </div>
  )
}

/** Semi-circular gauge (Storage / Bandwidth). */
export function ArcGauge({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'orange' }) {
  const pct = Math.max(0, Math.min(100, value))
  const r = 42
  const len = Math.PI * r
  const id = `g-${tone}`
  return (
    <div className="relative h-[72px] w-[112px]">
      <svg viewBox="0 0 112 64" className="h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" x2="1">
            <stop offset="0" stopColor={tone === 'blue' ? '#a9c6ff' : '#ffd29a'} />
            <stop offset="1" stopColor={tone === 'blue' ? '#5b8def' : '#f2734f'} />
          </linearGradient>
        </defs>
        <path
          d="M14 58 A42 42 0 0 1 98 58"
          fill="none"
          stroke="var(--am-border)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d="M14 58 A42 42 0 0 1 98 58"
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * len} ${len}`}
          />
        )}
      </svg>
      <span className="absolute inset-x-0 bottom-0 text-center text-xl font-medium">{Math.round(pct)}%</span>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line')}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 text-[13px] text-muted">{children}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-xl">
        <h3 className="text-[17px] font-medium">{title}</h3>
        <div className="mt-2 text-[13.5px] text-muted">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/** Small area chart for live stats. */
export function Sparkline({
  values,
  max,
  className,
}: {
  values: number[]
  max?: number
  className?: string
}) {
  const w = 120
  const h = 36
  const top = Math.max(max ?? 0, ...values, 1)
  const pts = values.map(
    (v, i) => [values.length < 2 ? w : (i / (values.length - 1)) * w, h - (v / top) * (h - 2) - 1] as const,
  )
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-9 w-full', className)}
      aria-hidden
    >
      {pts.length > 1 && (
        <>
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity="0.12" />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}
