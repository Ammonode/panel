import { describe, expect, test } from 'bun:test'
import { nextRun } from './schedules'

describe('nextRun', () => {
  const from = new Date('2026-11-09T12:30:20Z')
  const s = (m: string, h = '*', dom = '*', mon = '*', dow = '*') => ({
    cronMinute: m,
    cronHour: h,
    cronDayOfMonth: dom,
    cronMonth: mon,
    cronDayOfWeek: dow,
  })
  test('every minute is the next minute', () =>
    expect(nextRun(s('*'), from)?.toISOString()).toBe('2026-11-09T12:31:00.000Z'))
  test('daily at 04:00', () =>
    expect(nextRun(s('0', '4'), from)?.toISOString()).toBe('2026-11-10T04:00:00.000Z'))
  test('sundays at noon', () =>
    expect(nextRun(s('0', '12', '*', '*', '0'), from)?.toISOString()).toBe('2026-11-15T12:00:00.000Z'))
  test('impossible date returns null', () => expect(nextRun(s('0', '0', '31', '2'), from)).toBeNull())
})
