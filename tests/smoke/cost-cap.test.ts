import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tierBudgetUsd, usageRowCostUsd } from '../../lib/billing/costCap'

// Стражи долларового капа месяца (мандат Матвея 29.08: «тариф $50 → клиент не
// должен стоить нам больше ~$20»). Юниты ограничивают количество операций, но
// не их цену: Станислав (solo $49) сжёг $45 себестоимости за 5 дней — сообщение
// чата у контекста 228k стоило $0.37-1.43. Кап = 40% цены тарифа, факт расхода
// из журнала ai_usage, сброс — календарный месяц.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('tierBudgetUsd: кап = 40% цены тарифа', () => {
  it('число владельца: solo $49 → $20', () => {
    expect(tierBudgetUsd('solo')).toBe(20)
  })
  it('остальные тарифы пропорцией; trial как solo; мусор — как solo', () => {
    expect(tierBudgetUsd('starter')).toBe(10)
    expect(tierBudgetUsd('pro')).toBe(60)
    expect(tierBudgetUsd('producer')).toBe(120)
    expect(tierBudgetUsd('trial')).toBe(20)
    expect(tierBudgetUsd(null)).toBe(20)
    expect(tierBudgetUsd('nonsense' as never)).toBe(20)
  })
})

describe('usageRowCostUsd: зеркало формулы usage-report', () => {
  it('opus: вход + чтение 0.1× + запись 1ч 2× + выход', () => {
    const usd = usageRowCostUsd({
      provider: 'anthropic', model: 'claude-opus-5',
      input_tokens: 1000, output_tokens: 1000,
      meta: { cacheRead: 100000, cacheWrite1h: 100000, cacheWrite5m: 0, cacheWrite: 100000 },
    })
    // 1000×$5 + 100k×$0.5 + 100k×$10 + 1000×$25 = 0.005+0.05+1.0+0.025
    expect(usd).toBeCloseTo(1.08, 3)
  })
  it('легаси-строка без разбивки TTL — запись по 1.25×', () => {
    const usd = usageRowCostUsd({
      provider: 'anthropic', model: 'claude-opus-5',
      input_tokens: 0, output_tokens: 0,
      meta: { cacheRead: 0, cacheWrite: 100000 },
    })
    expect(usd).toBeCloseTo(0.625, 3)
  })
  it('whisper и apify оценены константами, неизвестная модель — 0', () => {
    expect(usageRowCostUsd({ provider: 'openai_whisper', model: 'whisper-1', input_tokens: null, output_tokens: null, meta: null })).toBe(0.05)
    expect(usageRowCostUsd({ provider: 'apify', model: 'x', input_tokens: null, output_tokens: null, meta: null })).toBe(0.01)
    expect(usageRowCostUsd({ provider: 'anthropic', model: 'unknown', input_tokens: 1e6, output_tokens: 1e6, meta: null })).toBe(0)
  })
})

describe('свип: кап стоит у КАЖДОЙ двери списания', () => {
  it('gateContentUnit и gateContentUnits зовут checkBudgetCap до списания', () => {
    const g = read('lib/generations.ts')
    expect((g.match(/checkBudgetCap\(userId\)/g) || []).length).toBe(2)
    expect(g).toContain("reason: 'budget'")
    expect(g).toContain("'not_entitled' | 'quota' | 'budget'")
  })
  it('gateMicroAction тоже под капом (иначе кап дырявый)', () => {
    const u = read('lib/ai/usage.ts')
    expect(u).toContain('checkBudgetCap(userId)')
    expect(u).toContain("reason: 'budget'")
  })
  it('исключения: админы и QA-бот вне капа; сбой чтения = fail-open', () => {
    const c = read('lib/billing/costCap.ts')
    expect(c).toContain("profile.role === 'admin'")
    expect(c).toContain('ama-qa-bot@gmail.com')
    expect(c).toContain('blocked: false }\n  }\n}')
    expect(c).toContain('captureException')
  })
  it('журнал листается страницами (ловушка PostgREST 1000 строк)', () => {
    const c = read('lib/billing/costCap.ts')
    expect(c).toMatch(/range\(fromRow, fromRow \+ 999\)/)
  })
})
