// Server-only. Два инструмента «плюсовой математики» (решение Матвея 25.08):
//
// 1) logAiUsage — журнал реальных расходов на провайдеров в таблицу ai_usage.
//    Fire-and-forget и fail-open: упавший лог НИКОГДА не ломает генерацию
//    (таблицы может не быть до миграции 039 — это штатно на первом деплое).
//
// 2) gateMicroAction — метеринг МЕЛКИХ AI-действий (сообщение ассистенту,
//    правка, подсказки, голосовой ввод): UNIT_COSTS.micro_batch штук = 1 юнит,
//    через RPC consume_micro_action (та же месячная механика/бонусы, что у
//    consume_generation). При исчерпанном лимите блокируется каждое действие.
//    Fail-OPEN на любой инфраструктурной ошибке (RPC ещё не применена и т.п.) —
//    незадеплоенная миграция не должна останавливать продукт.
import { createAdminClient } from '@/lib/supabase/admin'
import { BILLING_ENFORCED } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'

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

// Не await'ится вызывающими — сознательно (лог не должен добавлять латентность
// и тем более ронять запрос). void logAiUsage({...}) в местах вызова.
export async function logAiUsage(row: AiUsageRow): Promise<void> {
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
      usageWarned = true // не спамим: до миграции 039 каждый вызов падал бы
      console.warn('[ai_usage] insert failed (fail-open):', error.message)
    }
  } catch (e) {
    if (!usageWarned) {
      usageWarned = true
      console.warn('[ai_usage] failed (fail-open):', e instanceof Error ? e.message : e)
    }
  }
}

export interface MicroGateResult {
  blocked: boolean
  // Совпадает с контрактом gateContentUnit: чат/правки уже стоят ЗА
  // requirePaidAccess (not_entitled отсечён раньше), поэтому здесь причина
  // всегда quota.
  reason?: 'quota'
}

// Одно мелкое AI-действие. Вызывать ПОСЛЕ requirePaidAccess. Возвращает
// blocked=true только при живом BILLING_ENFORCED и полностью исчерпанном
// лимите — вызывающий отвечает 402 { code: 'limit_reached' }.
export async function gateMicroAction(userId: string, route: string): Promise<MicroGateResult> {
  try {
    const { data, error } = await createAdminClient().rpc('consume_micro_action', {
      p_user_id: userId,
      p_batch: UNIT_COSTS.micro_batch,
    })
    if (error) {
      // Миграция 039 не применена / временная ошибка БД — не блокируем.
      console.warn('[gateMicroAction] rpc failed (fail-open):', error.message)
      return { blocked: false }
    }
    if (data === false && BILLING_ENFORCED) return { blocked: true, reason: 'quota' }
    return { blocked: false }
  } catch (e) {
    console.warn('[gateMicroAction] failed (fail-open):', e instanceof Error ? e.message : e)
    return { blocked: false }
  }
}
