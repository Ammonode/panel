import { describe, expect, test } from 'bun:test'
import { remainingFraction } from './upgrades'

describe('proration', () => {
  const expires = new Date('2026-12-09T00:00:00Z') // monthly period started 2026-11-09
  test('full period left right after renewal', () => expect(remainingFraction(expires, 1, 'month', new Date('2026-11-09T00:00:00Z'))).toBe(1))
  test('half way through', () => expect(remainingFraction(expires, 1, 'month', new Date('2026-11-24T00:00:00Z'))).toBe(0.5))
  test('expired gives zero', () => expect(remainingFraction(expires, 1, 'month', new Date('2026-12-10T00:00:00Z'))).toBe(0))
  test('yearly', () => expect(remainingFraction(new Date('2027-11-09T00:00:00Z'), 1, 'year', new Date('2027-05-10T12:00:00Z'))).toBeCloseTo(0.5, 2))
})
