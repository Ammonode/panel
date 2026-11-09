import { describe, expect, test } from 'bun:test'
import { cronMatches } from './scheduler'

describe('cron', () => {
  const d = new Date('2026-11-09T12:30:00Z') // Monday
  test('matches common expressions', () => {
    expect(cronMatches('* * * * *', d)).toBe(true)
    expect(cronMatches('*/10 * * * *', d)).toBe(true)
    expect(cronMatches('*/7 * * * *', d)).toBe(false)
    expect(cronMatches('30 12 * * 1', d)).toBe(true)
    expect(cronMatches('30 12 * * 0', d)).toBe(false)
    expect(cronMatches('0-30 12 9 11 *', d)).toBe(true)
    expect(cronMatches('15,30,45 * * * *', d)).toBe(true)
  })
})
