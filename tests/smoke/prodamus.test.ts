import { describe, it, expect } from 'vitest'
import { prodamusSign, prodamusVerify, parseFormNested, buildOrderId, parseOrderId, mapProdamusStatus } from '@/lib/billing/prodamus'

// Payment-webhook signature logic. A silent regression here = either rejecting
// every real payment or accepting forged callbacks. Never touch without tests.
const SECRET = 'test-secret'

describe('prodamus signature', () => {
  it('sign/verify roundtrip', () => {
    const data = { order_id: 'u1.solo.123', sum: '4900.00', payment_status: 'success' }
    const sign = prodamusSign(data, SECRET)
    expect(sign).toMatch(/^[0-9a-f]{64}$/)
    expect(prodamusVerify(data, sign, SECRET)).toBe(true)
  })

  it('rejects tampered data and wrong secret', () => {
    const data = { order_id: 'u1.solo.123', sum: '4900.00' }
    const sign = prodamusSign(data, SECRET)
    expect(prodamusVerify({ ...data, sum: '1.00' }, sign, SECRET)).toBe(false)
    expect(prodamusVerify(data, sign, 'other-secret')).toBe(false)
    expect(prodamusVerify(data, '', SECRET)).toBe(false)
  })

  it('signature is stable across key order and nesting (PHP ksort semantics)', () => {
    const a = { b: '2', a: '1', nested: { y: '2', x: '1' } }
    const b = { nested: { x: '1', y: '2' }, a: '1', b: '2' }
    expect(prodamusSign(a, SECRET)).toBe(prodamusSign(b, SECRET))
  })

  it('sequential-keyed objects encode as PHP arrays', () => {
    // products[0][name]=X — PHP sees a list; {'0': {...}} must sign like [{...}]
    const asMap = { products: { '0': { name: 'X' } } }
    const asList = { products: [{ name: 'X' }] }
    expect(prodamusSign(asMap, SECRET)).toBe(prodamusSign(asList, SECRET))
  })
})

describe('prodamus form body parsing', () => {
  it('parses php-style nested keys', () => {
    const body = 'order_id=u1.solo.1&products[0][name]=Solo&products[0][price]=4900&sum=4900.00'
    const parsed = parseFormNested(body) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(parsed.order_id).toBe('u1.solo.1')
    expect(parsed.sum).toBe('4900.00')
    expect(parsed.products['0'].name).toBe('Solo')
  })
})

describe('order id + status mapping', () => {
  it('order id roundtrip', () => {
    const id = buildOrderId('4cafd9a1-0000-0000-0000-000000000001', 'producer', 1700000000000)
    const parsed = parseOrderId(id)
    expect(parsed?.userId).toBe('4cafd9a1-0000-0000-0000-000000000001')
    expect(parsed?.plan).toBe('producer')
  })
  it('status mapping', () => {
    expect(mapProdamusStatus('success')).toBe('active')
    expect(mapProdamusStatus('failed')).toBe('past_due')
    expect(mapProdamusStatus('')).toBe('past_due')
  })
})
