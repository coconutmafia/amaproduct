// Долларовый кап себестоимости на клиента в месяц (мандат Матвея 29.08).
//
// Зачем: юниты ограничивают КОЛИЧЕСТВО операций, но не их ЦЕНУ — сообщение
// чата у проекта с контекстом 228k токенов стоило нам $0.37-1.43, и Станислав
// на тарифе $49 сжёг $45 себестоимости за 5 дней. Правило владельца: «тариф
// стоит $50 — клиент не должен стоить нам больше $20». Кап = 40% цены тарифа;
// журнал ai_usage (пишется с 25.08 на каждый AI-вызов) даёт факт расхода.
//
// Механика: перед КАЖДЫМ списанием (юниты и микро-действия) сверяем расход
// календарного месяца с капом тарифа. Превышен → 402 limit_reached (тот же
// UX «лимит месяца исчерпан» с предложением тарифа выше; 1-го числа расход
// обнуляется сам — журнал месячный). Админы и служебный QA-бот вне капа.
// Любая ошибка чтения — fail-open: сбой инфраструктуры не должен запирать
// платящих клиентов (урок silent-fail-open: но здесь open = пропустить).
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { PLAN_CONFIG, type SubscriptionTier } from '@/lib/generations-config'

const QA_EMAIL = 'ama-qa-bot@gmail.com'

// Кап месяца по тарифу: 40% цены (solo $49 → $20 — число владельца), trial
// считаем как solo (демо жжёт те же деньги). Пол — $10, чтобы округление не
// занулило будущие дешёвые тарифы.
export function tierBudgetUsd(tier: SubscriptionTier | null | undefined): number {
  const t: SubscriptionTier = (tier && tier in PLAN_CONFIG ? tier : 'solo') as SubscriptionTier
  const price = PLAN_CONFIG[t].price || PLAN_CONFIG.solo.price
  return Math.max(10, Math.round(price * 0.4))
}

// Цена одной строки журнала — ЗЕРКАЛО формулы usage-report (prod-probe.mjs):
// кэш-чтение 0.1×, запись 5м 1.25×, запись 1ч 2× (легаси-строки без разбивки
// по TTL — 1.25×). Не-Claude провайдеры оценены константами того же порядка,
// что в отчёте (whisper-чанк ≈ 8 мин, apify-скрейп). Прайс моделей живёт в
// lib/ai/client.ts рядом с id моделей (страж model-upgrade).
import { MODEL_PRICES_USD } from '@/lib/ai/client'

type UsageRow = {
  provider: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  meta: Record<string, unknown> | null
}

export function usageRowCostUsd(r: UsageRow): number {
  // Строка Whisper = один 10-минутный чанк (CHUNK_SEC в runTranscribeJob) × $0.006/мин
  if (r.provider === 'openai_whisper') return 0.06
  if (r.provider === 'apify') return 0.01
  // Картинки: gpt-image-1 medium $0.063 ЗА КАЖДЫЙ вариант (meta.count).
  // Без этой ветки кап был СЛЕП к картинкам (нашлось свипом 29.08 — ровно
  // класс «лимит должен покрывать реальный путь расхода»).
  if (r.provider === 'openai_image') {
    const count = Number((r.meta as Record<string, unknown> | null)?.count ?? 1) || 1
    return count * 0.063
  }
  const p = MODEL_PRICES_USD[r.model ?? '']
  if (!p) return 0
  const n = (k: string) => Number((r.meta as Record<string, unknown> | null)?.[k] ?? 0) || 0
  const cr = n('cacheRead')
  const cw5 = n('cacheWrite5m')
  const cw1 = n('cacheWrite1h')
  const cwLegacy = n('cacheWrite')
  const writeUsd = cw5 + cw1 > 0 ? cw5 * p.inUsd * 1.25 + cw1 * p.inUsd * 2 : cwLegacy * p.inUsd * 1.25
  return ((r.input_tokens ?? 0) * p.inUsd + cr * p.inUsd * 0.1 + writeUsd + (r.output_tokens ?? 0) * p.outUsd) / 1e6
}

export type BudgetCheck = {
  blocked: boolean
  spentUsd?: number
  capUsd?: number
}

// Расход клиента с начала календарного месяца (UTC — как сбросы юнитов).
export async function monthSpendUsd(userId: string): Promise<number> {
  const admin = createAdminClient()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  let sum = 0
  // Страницами: PostgREST по умолчанию отдаёт максимум 1000 строк, а у
  // активного клиента их может быть больше (ловушка из памяти postgrest).
  for (let fromRow = 0; ; fromRow += 1000) {
    const { data, error } = await admin
      .from('ai_usage')
      .select('provider, model, input_tokens, output_tokens, meta')
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString())
      .range(fromRow, fromRow + 999)
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as UsageRow[]) sum += usageRowCostUsd(r)
    if (!data || data.length < 1000) break
  }
  return sum
}

// Главная проверка: зовётся из ОБОИХ гейтов (юниты и микро) ДО списания.
export async function checkBudgetCap(userId: string): Promise<BudgetCheck> {
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role, email, subscription_tier')
      .eq('id', userId)
      .single()
    if (!profile) return { blocked: false }
    if (profile.role === 'admin') return { blocked: false }
    if ((profile.email ?? '').toLowerCase() === QA_EMAIL) return { blocked: false }
    const capUsd = tierBudgetUsd(profile.subscription_tier as SubscriptionTier)
    const spentUsd = await monthSpendUsd(userId)
    return { blocked: spentUsd >= capUsd, spentUsd, capUsd }
  } catch (e) {
    // fail-open: кап — предохранитель маржи, а не выключатель продукта
    await captureException(e, { where: 'checkBudgetCap', userId }).catch(() => {})
    return { blocked: false }
  }
}
