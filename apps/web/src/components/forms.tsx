import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, Input, Toggle } from './ui'

export type SettingField = {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'email' | 'number' | 'boolean' | 'select'
  description?: string
  default?: unknown
  required?: boolean
  min?: number
  max?: number
  options?: { value: string; label: string }[]
}

const selectClass = 'h-10 w-full rounded-[10px] border border-line bg-surface px-3 text-sm'

/** Renders a form from a settings schema (used for extensions and provisioner product settings). */
export function SchemaForm({
  fields,
  values,
  onChange,
}: {
  fields: SettingField[]
  values: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v })
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fields.map((f) => {
        const value = values[f.key] ?? f.default ?? ''
        return (
          <Field key={f.key} label={f.label + (f.required ? ' *' : '')} hint={f.description}>
            {f.type === 'boolean' ? (
              <div className="pt-1">
                <Toggle checked={!!value} onChange={(v) => set(f.key, v)} label={f.label} />
              </div>
            ) : f.type === 'select' ? (
              <select
                className={selectClass}
                value={String(value)}
                onChange={(e) => set(f.key, e.target.value)}
              >
                {!f.default && <option value="">Select…</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={String(value)}
                min={f.min}
                max={f.max}
                autoComplete="off"
                onChange={(e) =>
                  set(
                    f.key,
                    f.type === 'number'
                      ? e.target.value === ''
                        ? ''
                        : Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </Field>
        )
      })}
    </div>
  )
}

export type PlanForm = {
  id?: number
  name: string
  type: 'free' | 'one-time' | 'recurring'
  billingPeriod: number
  billingUnit: 'day' | 'week' | 'month' | 'year'
  prices: { currency: string; price: string; setupFee: string }[]
}

export const emptyPlan = (currency: string): PlanForm => ({
  name: 'Monthly',
  type: 'recurring',
  billingPeriod: 1,
  billingUnit: 'month',
  prices: [{ currency, price: '0.00', setupFee: '0.00' }],
})

/** Editor for the plans (billing cycles) and their price per currency. */
export function PlansEditor({
  plans,
  onChange,
  currencies,
  compact,
}: {
  plans: PlanForm[]
  onChange: (p: PlanForm[]) => void
  currencies: string[]
  compact?: boolean
}) {
  const update = (i: number, patch: Partial<PlanForm>) =>
    onChange(plans.map((p, j) => (i === j ? { ...p, ...patch } : p)))
  const price = (p: PlanForm, cur: string) =>
    p.prices.find((x) => x.currency === cur) ?? { currency: cur, price: '', setupFee: '' }
  const setPrice = (i: number, cur: string, patch: Partial<PlanForm['prices'][number]>) => {
    const p = plans[i]!
    const rest = p.prices.filter((x) => x.currency !== cur)
    update(i, { prices: [...rest, { ...price(p, cur), ...patch }] })
  }
  return (
    <div className="space-y-3">
      {plans.map((p, i) => (
        <div
          key={p.id ?? `new-${i}`}
          className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-3"
        >
          <div className="flex flex-wrap items-end gap-2">
            {!compact && (
              <Field label="Name">
                <Input
                  value={p.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="w-36"
                />
              </Field>
            )}
            <Field label="Type">
              <select
                className={`${selectClass} w-32`}
                value={p.type}
                onChange={(e) => update(i, { type: e.target.value as PlanForm['type'] })}
              >
                <option value="recurring">Recurring</option>
                <option value="one-time">One time</option>
                <option value="free">Free</option>
              </select>
            </Field>
            {p.type === 'recurring' && (
              <>
                <Field label="Every">
                  <Input
                    type="number"
                    min={1}
                    value={p.billingPeriod}
                    onChange={(e) => update(i, { billingPeriod: Number(e.target.value) })}
                    className="w-20"
                  />
                </Field>
                <Field label="Unit">
                  <select
                    className={`${selectClass} w-28`}
                    value={p.billingUnit}
                    onChange={(e) => update(i, { billingUnit: e.target.value as PlanForm['billingUnit'] })}
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="year">Year</option>
                  </select>
                </Field>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              aria-label="Remove plan"
              onClick={() => onChange(plans.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {p.type !== 'free' && (
            <div className="flex flex-wrap gap-3">
              {currencies.map((cur) => (
                <div key={cur} className="flex items-end gap-2">
                  <Field label={`Price (${cur})`}>
                    <Input
                      inputMode="decimal"
                      className="w-28"
                      value={price(p, cur).price}
                      onChange={(e) => setPrice(i, cur, { price: e.target.value })}
                    />
                  </Field>
                  <Field label="Setup fee">
                    <Input
                      inputMode="decimal"
                      className="w-24"
                      value={price(p, cur).setupFee}
                      onChange={(e) => setPrice(i, cur, { setupFee: e.target.value })}
                    />
                  </Field>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...plans, emptyPlan(currencies[0] ?? 'USD')])}
      >
        <Plus className="size-3.5" /> Add plan
      </Button>
    </div>
  )
}

/** Converts API plans (with string ids, nested prices) into the editor shape. */
export function toPlanForms(
  plans: {
    id: number
    name: string
    type: string
    billingPeriod: number
    billingUnit: string
    prices: { currency: string; price: string; setupFee: string }[]
  }[],
): PlanForm[] {
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as PlanForm['type'],
    billingPeriod: p.billingPeriod,
    billingUnit: p.billingUnit as PlanForm['billingUnit'],
    prices: p.prices.filter((x) => x.price !== ''),
  }))
}

export const cleanPlans = (plans: PlanForm[]) =>
  plans.map((p) => ({
    ...p,
    prices: p.prices.filter((x) => x.price !== '').map((x) => ({ ...x, setupFee: x.setupFee || '0' })),
  }))
