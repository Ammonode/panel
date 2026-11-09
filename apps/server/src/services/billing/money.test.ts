import { describe, expect, test } from 'bun:test'
import { addPeriod, fromCents, percentOf, toCents } from './money'

describe('money', () => {
  test('converts without float errors', () => {
    expect(toCents('19.99') + toCents('0.01')).toBe(2000)
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30')
    expect(percentOf(999, 21)).toBe(210)
  })
  test('adds months clamping to the end of month', () => {
    expect(addPeriod(new Date('2026-01-31T10:00:00Z'), 1, 'month').toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    )
    expect(addPeriod(new Date('2028-01-31T00:00:00Z'), 1, 'month').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
    expect(addPeriod(new Date('2026-03-15T00:00:00Z'), 1, 'year').toISOString()).toBe(
      '2027-03-15T00:00:00.000Z',
    )
    expect(addPeriod(new Date('2026-03-15T00:00:00Z'), 2, 'week').toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    )
  })
})
