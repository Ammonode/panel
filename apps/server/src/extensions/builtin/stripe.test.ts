import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { verifyStripeSignature } from './stripe'

const secret = 'whsec_test'
const payload = '{"id":"evt_1"}'
const sign = (t: number, body = payload, key = secret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`

describe('stripe webhook signature', () => {
  const now = 1_800_000_000_000
  const t = now / 1000
  test('accepts a valid signature', () =>
    expect(verifyStripeSignature(payload, sign(t), secret, now)).toBe(true))
  test('rejects a modified payload', () =>
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(t), secret, now)).toBe(false))
  test('rejects the wrong secret', () =>
    expect(verifyStripeSignature(payload, sign(t, payload, 'other'), secret, now)).toBe(false))
  test('rejects old timestamps', () =>
    expect(verifyStripeSignature(payload, sign(t - 600), secret, now)).toBe(false))
  test('rejects missing header parts', () =>
    expect(verifyStripeSignature(payload, 't=1', secret, now)).toBe(false))
})
