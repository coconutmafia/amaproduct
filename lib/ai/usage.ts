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
import { setUsageUser } from '@/lib/ai/usageContext'

// Журнал расходов живёт в отдельном модуле без лишних зависимостей (его
// статически импортирует обёртка Anthropic) — здесь только ре-экспорт, чтобы
// прежние импорты из '@/lib/ai/usage' продолжали работать.
export { logAiUsage } from '@/lib/ai/usageLog'
export type { AiProvider, AiUsageRow } from '@/lib/ai/usageLog'

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
export async function gateMicroAction(
  userId: string,
  route: string,
  batch: number = UNIT_COSTS.micro_batch,
): Promise<MicroGateResult> {
  setUsageUser(userId) // журнал расходов узнает, чей это вызов
  try {
    const { data, error } = await createAdminClient().rpc('consume_micro_action', {
      p_user_id: userId,
      p_batch: batch,
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
