import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCachedSystem } from '@/lib/ai/client'

// Стражи часового TTL кэша промпта (29.08).
//
// Замер на 4 днях прода: чат = 93% всех AI-затрат, и 84% его цены — ЗАПИСИ
// кэша ($76.94 из $91.74): дефолтный 5-минутный TTL короче реальной паузы
// человека между сообщениями, 79 из 187 вызовов чата были полной перезаписью
// контекста (у Станислава — 228k токенов по $1.43 за перезапись). Часовой TTL:
// запись 2× вместо 1.25×, чтение то же (~10%) и бесплатно продлевает таймер;
// симуляция на реальном логе вызовов дала −37% на чате.
//
// Правило порядка Anthropic: блоки с ДЛИННЫМ TTL должны стоять раньше коротких.
// Система (1h) — первый блок, брейкпоинт истории (1h) — последний; смешение
// «система 5m + история 1h» было бы 400 — поэтому TTL меняется ПАРОЙ.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('часовой TTL кэша', () => {
  it('системный блок (buildCachedSystem) кэшируется с ttl 1h', () => {
    const sys = buildCachedSystem('большой стабильный промпт')
    expect(sys).toHaveLength(1)
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(sys[0].text).toBe('большой стабильный промпт')
  })
  it('брейкпоинт истории чата — тоже 1h (TTL меняется парой, не поодиночке)', () => {
    const chat = read('app/api/ai/chat/route.ts')
    expect(chat).toMatch(/cache_control: \{ type: 'ephemeral' as const, ttl: '1h' as const \}/)
    // Ни одного 5-минутного брейкпоинта в чате не осталось
    expect(chat).not.toMatch(/cache_control: \{ type: 'ephemeral' as const \}(?!, ttl)/)
  })
  it('учёт токенов пишет разбивку записей по TTL (5м=1.25×, 1ч=2× — иначе отчёт врёт)', () => {
    const client = read('lib/ai/client.ts')
    expect(client).toContain('cacheWrite5m: usage.cache_creation?.ephemeral_5m_input_tokens')
    expect(client).toContain('cacheWrite1h: usage.cache_creation?.ephemeral_1h_input_tokens')
  })
  it('usage-report ценит записи по TTL-разбивке (легаси-строки — по 1.25×)', () => {
    const probe = read('scripts/prod-probe.mjs')
    expect(probe).toMatch(/cw5 \* p\.in \* 1\.25 \+ cw1 \* p\.in \* 2/)
  })
})
