/**
 * Money is handled as integer cents to avoid floating point errors and stored
 * as numeric strings in the database.
 */
export const toCents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100)
export const fromCents = (cents: number) => (cents / 100).toFixed(2)
export const percentOf = (cents: number, percent: number) => Math.round((cents * percent) / 100)

export type BillingUnit = 'day' | 'week' | 'month' | 'year'

/** Adds `period` billing units to a date, clamping month ends (Jan 31 + 1 month = Feb 28). */
export function addPeriod(date: Date, period: number, unit: BillingUnit | string): Date {
  const d = new Date(date)
  switch (unit) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + period)
      return d
    case 'week':
      d.setUTCDate(d.getUTCDate() + period * 7)
      return d
    case 'year':
    case 'month': {
      const months = unit === 'year' ? period * 12 : period
      const day = d.getUTCDate()
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() + months)
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
      d.setUTCDate(Math.min(day, last))
      return d
    }
    default:
      throw new Error(`Unknown billing unit ${unit}`)
  }
}

export function describePeriod(period: number, unit: string) {
  if (period === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit] ?? unit
  if (unit === 'month' && period === 3) return 'Quarterly'
  if (unit === 'month' && period === 6) return 'Semi-annually'
  return `Every ${period} ${unit}s`
}
