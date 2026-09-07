import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isAmaSubscriptionPayment, prodamusSign, prodamusVerify, parseFormNested, buildOrderId, parseOrderId, mapProdamusStatus, resolveMerchantOrder, parseTopupPayment, webhookEvidence } from '@/lib/billing/prodamus'

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

// Регрессия 17 июля: кабинет Продамуса общий с продуктами Августы, и её продажи
// прилетали в наш вебхук. Код записывал их в леджер как оплату тарифа —
// 79 666 ₽ чужих денег в /admin/payments. Данные ниже — реальные из прода.
describe('isAmaSubscriptionPayment', () => {
  it('пропускает наши: подписка есть', () => {
    expect(isAmaSubscriptionPayment({ subscription: { id: '2946756', cost: 4900, name: 'Соло' }, orderId: '46768088' })).toBe(true)
  })

  it('пропускает наши: рекуррентное списание — только subscription_id', () => {
    expect(isAmaSubscriptionPayment({ subscriptionId: '2946756', orderId: '46779478' })).toBe(true)
  })

  it('пропускает наши: старый формат order_id (userId.plan.ts)', () => {
    expect(isAmaSubscriptionPayment({ orderId: '053bed66-9c88-49a0-bfca-cb85fac07fa9.solo.1784278399533' })).toBe(true)
  })

  it('режет чужие: разовые покупки продуктов Августы', () => {
    // 20 000 ₽ — arina-kozlova-01, аккаунта в AMA нет
    expect(isAmaSubscriptionPayment({ orderId: '46792048' })).toBe(false)
    // 16 666 ₽ — Korolyok51, аккаунта нет
    expect(isAmaSubscriptionPayment({ orderId: '46788810' })).toBe(false)
    // 43 000 ₽ — alisa_132: ДЕЙСТВУЮЩИЙ подписчик AMA купил продукт Августы.
    // Совпадение email не должно делать платёж нашим.
    expect(isAmaSubscriptionPayment({ orderId: '46787772' })).toBe(false)
  })

  it('пустые/мусорные значения не считаются подпиской', () => {
    expect(isAmaSubscriptionPayment({})).toBe(false)
    expect(isAmaSubscriptionPayment({ subscription: null, subscriptionId: null, orderId: '' })).toBe(false)
    expect(isAmaSubscriptionPayment({ subscriptionId: '', orderId: '46792048' })).toBe(false)
  })
})

// 07.09 (Виктория Курбатова, «Соло без демо», 4 900 ₽ на чужую почту): в
// уведомлении Продамуса `order_id` — «ID заказа в системе Prodamus» (их
// 48521255), а НАШ userId.plan.ts возвращается полем `order_num` («номер
// заказа на стороне магазина»). Код читал только order_id → «пользователь не
// найден». Теперь наш номер ищем в обоих полях, order_num первым, и только с
// настоящим UUID (данные с формы — не доверяем строке «что-то.solo»).
describe('resolveMerchantOrder — наш номер заказа в order_num', () => {
  const U = '6405276f-c82b-4ee9-b346-69e2bde9ff02'
  it('order_num несёт userId.plan.ts, order_id — числовой Продамуса', () => {
    expect(resolveMerchantOrder({ order_id: '48521255', order_num: `${U}.solo.1788000000000` })).toEqual({ userId: U, plan: 'solo' })
  })
  it('старый формат в order_id по-прежнему распознаётся', () => {
    expect(resolveMerchantOrder({ order_id: `${U}.pro.1` })).toEqual({ userId: U, plan: 'pro' })
  })
  it('без нашего формата / с не-UUID — null (чужой платёж, подделка)', () => {
    expect(resolveMerchantOrder({ order_id: '48521255', order_num: '48521255' })).toBeNull()
    expect(resolveMerchantOrder({ order_id: '48521255', order_num: 'admin.producer.1' })).toBeNull()
    expect(resolveMerchantOrder({})).toBeNull()
  })
  it('докупка и «наш платёж» тоже видят order_num', () => {
    expect(parseTopupPayment({ order_id: '1', order_num: `${U}.topup-solo.5` })).toEqual({ userId: U, plan: 'solo' })
    expect(isAmaSubscriptionPayment({ orderId: '48521255', orderNum: `${U}.solo.5` })).toBe(true)
  })
  it('улика в журнал: ключи + оба номера + customer_extra', () => {
    const ev = webhookEvidence({ order_id: '1', order_num: 'x', customer_extra: '', sum: '1' })
    expect(ev).toEqual({ keys: 'order_id,order_num,customer_extra,sum', order_id: '1', order_num: 'x', customer_extra: '' })
  })
  it('вебхук: пользователь — по нашему номеру ПЕРВЫМ, потом email/billing_email, подписка — последней и только при одном владельце', () => {
    const src = readFileSync(`${process.cwd()}/app/api/billing/prodamus/webhook/route.ts`, 'utf8')
    const iOrder = src.indexOf('resolveMerchantOrder(data')
    const iEmail = src.indexOf("userId = await findUserByEmail(admin")
    const iSub = src.indexOf("eq('provider_subscription_id', String(subId)).limit(2)")
    expect(iOrder).toBeGreaterThan(0)
    expect(iEmail).toBeGreaterThan(iOrder)
    expect(iSub).toBeGreaterThan(iEmail)
    // subscription.id у Продамуса = id продукта (2946756 у 16 клиентов) — maybeSingle тут нельзя
    expect(src).not.toContain("eq('provider_subscription_id', String(subId)).maybeSingle()")
    expect(src).toContain("ilike('billing_email', email)")
    expect(src).toContain('webhookEvidence(data')
    // миграция и пробник знают про почту плательщика
    expect(readFileSync(`${process.cwd()}/supabase/migrations/050_billing_email.sql`, 'utf8')).toContain('billing_email')
    expect(readFileSync(`${process.cwd()}/scripts/prod-probe.mjs`, 'utf8')).toContain("arg('billing-email')")
  })
})
