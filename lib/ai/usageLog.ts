// Server-only. Журнал реальных расходов на провайдеров (таблица ai_usage).
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, а не вместе с гейтом в lib/ai/usage.ts: обёртка вокруг
// Anthropic (lib/ai/client.ts) обязана импортировать это СТАТИЧЕСКИ и не тащить
// за собой ничего лишнего. Первая версия звала usage.ts динамическим импортом
// (чтобы не тянуть цепочку generations → supabase/server → next/headers) и
// глушила ошибку в .catch — в проде это дало ноль строк от Claude при живых
// строках Whisper. Здесь зависимость ровно одна: админский клиент Supabase.
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type AiProvider = 'anthropic' | 'openai_whisper' | 'openai_image' | 'apify'

export interface AiUsageRow {
  userId?: string | null
  route: string
  provider: AiProvider
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  meta?: Record<string, unknown>
}

let usageWarned = false

// ЗАПИСЬ ЧЕРЕЗ after(): просто «выстрелить и забыть» на Vercel НЕДОСТАТОЧНО —
// инстанс замораживается сразу после ответа, и незавершённый insert умирает по
// дороге. Замерено 25.08: строки Whisper (пишутся из фонового джоба, который
// продолжает работать) в журнале были, а строки Claude из обычных роутов — нет
// ни одной. after() говорит платформе «дай доработать после ответа»; вне
// request-контекста (внутри фонового джоба) он недоступен — тогда пишем прямо,
// там инвокация и так живёт.
export async function logAiUsage(row: AiUsageRow): Promise<void> {
  try {
    after(() => insertUsage(row))
    return
  } catch {
    // не request-контекст (внутри фонового джоба after() недоступен) —
    // пишем напрямую: там инвокация и так продолжает работать
  }
  await insertUsage(row)
}

// Fail-open: до применения миграции 039 таблицы нет, и это штатно —
// предупреждаем один раз, а не на каждый вызов.
async function insertUsage(row: AiUsageRow): Promise<void> {
  try {
    const { error } = await createAdminClient().from('ai_usage').insert({
      user_id: row.userId ?? null,
      route: row.route.slice(0, 120),
      provider: row.provider,
      model: row.model ?? null,
      input_tokens: row.inputTokens ?? null,
      output_tokens: row.outputTokens ?? null,
      meta: row.meta ?? null,
    })
    if (error && !usageWarned) {
      usageWarned = true
      console.warn('[ai_usage] insert failed (fail-open):', error.message)
    }
  } catch (e) {
    if (!usageWarned) {
      usageWarned = true
      console.warn('[ai_usage] failed (fail-open):', e instanceof Error ? e.message : e)
    }
  }
}
