import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatEstimateUsd, contextKeyOf, CACHE_WARM_WINDOW_MS } from '@/lib/billing/chatPricing'
import { MODEL_PRICES_USD } from '@/lib/ai/client'
import { CHAT_ESTIMATE_OUTPUT_TOKENS } from '@/lib/generations-config'

// Даша 07.09: «написано 5, а списывается 25». Замер по журналу: 80% цены её
// чата — запись 155 тыс. токенов контекста в кэш при первом сообщении после
// перерыва (>1 ч); оценка же считала кэш тёплым по наличию истории в чате.
// Тёплый кэш — это состояние (был ли запрос с ТЕМ ЖЕ контекстом за последний
// час), а не свойство диалога. Стражи: формула, ключ контекста, обе точки.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('chatEstimateUsd — холодный и тёплый кэш считаются по-разному', () => {
  const p = MODEL_PRICES_USD['claude-opus-5']
  const out = CHAT_ESTIMATE_OUTPUT_TOKENS * p.outUsd / 1e6
  it('холодный: весь промпт пишется в кэш (2×)', () => {
    expect(chatEstimateUsd(150_000, 1_000, false, 'claude-opus-5')).toBeCloseTo(150_000 * p.inUsd * 2 / 1e6 + out, 4)
  })
  it('тёплый: префикс читается из кэша (0.1×), хвост пишется (2×)', () => {
    expect(chatEstimateUsd(150_000, 1_000, true, 'claude-opus-5')).toBeCloseTo((149_000 * p.inUsd * 0.1 + 1_000 * p.inUsd * 2) / 1e6 + out, 4)
  })
  it('на контексте Даши холодный старт ≈ в 10 раз дороже тёплого сообщения', () => {
    const cold = chatEstimateUsd(155_000, 1_500, false, 'claude-opus-5')
    const warm = chatEstimateUsd(155_000, 1_500, true, 'claude-opus-5')
    expect(cold / warm).toBeGreaterThan(8)
    expect(cold).toBeGreaterThan(1.5) // ≈ $1.6 → ≈ 25 ед. при $0.065 за единицу
  })
  it('окно тёплого кэша меньше часа (TTL 1 ч, запас на генерацию)', () => {
    expect(CACHE_WARM_WINDOW_MS).toBeLessThan(60 * 60 * 1000)
    expect(CACHE_WARM_WINDOW_MS).toBeGreaterThan(45 * 60 * 1000)
  })
})

describe('contextKeyOf — ключ стабильного префикса', () => {
  it('одинаковые блоки → один ключ; любое изменение текста → другой', () => {
    const a = contextKeyOf(['system', 'saved'])
    expect(contextKeyOf([{ text: 'system' }, { text: 'saved' }])).toBe(a)
    expect(contextKeyOf(['system', 'saved ']) === a).toBe(false)
    expect(contextKeyOf(['systemsaved'])).not.toBe(a) // граница блоков входит в ключ
    expect(a).toMatch(/^[0-9a-f]{24}$/)
  })
})

describe('оценка и списание знают про тёплый кэш', () => {
  it('роут оценки спрашивает isContextWarm по ключу тех же блоков и отдаёт режим', () => {
    const r = read('app/api/ai/chat/estimate/route.ts')
    expect(r).toContain('isContextWarm(contextKeyOf(systemBlocks))')
    expect(r).toContain("mode: est.warm ? 'warm' : 'cold'")
    expect(r).toContain('warmUnits: est.warmUnits')
  })
  it('чат пишет contextKey в ленту при списании (обе ветки) и гейтит по тому же теплу', () => {
    const c = read('app/api/ai/chat/route.ts')
    expect(c).toContain('meta: { contextKey: saKey }')
    expect(c).toContain('meta: { contextKey: projKey, projectId }')
    expect(c.split('isContextWarm(').length - 1).toBe(2)
  })
  it('оба чата объясняют холодный старт словами, а не молча показывают «≈ 2»', () => {
    for (const f of ['app/(dashboard)/create/page.tsx', 'app/(dashboard)/projects/[id]/assistant/page.tsx']) {
      const s = read(f)
      expect(s, f).toContain('Первое сообщение после перерыва')
      expect(s, f).toContain('в течение часа')
    }
  })
})
