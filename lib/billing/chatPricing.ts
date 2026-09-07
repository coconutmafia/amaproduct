import { anthropic, MODEL } from '@/lib/ai/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODEL_PRICES_USD } from '@/lib/ai/client'
import { unitsForUsd, CHAT_ESTIMATE_OUTPUT_TOKENS, UNIT_COSTS } from '@/lib/generations-config'
import { recordUnits } from '@/lib/billing/unitLedger'
import { createHash } from 'node:crypto'

// Честные единицы для чата (05.09): оценка ДО отправки и списание ПО ФАКТУ.
// Наружу — только единицы; доллары живут здесь и в журнале.

export type ChatUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

type SystemBlock = { type: 'text'; text: string; cache_control?: unknown }
type ApiMessage = { role: 'user' | 'assistant'; content: unknown }

// Цена текущей модели; фолбэк — первая в прайс-листе (единый источник в client.ts)
const price = () => MODEL_PRICES_USD[MODEL] ?? MODEL_PRICES_USD[Object.keys(MODEL_PRICES_USD)[0]]

/** Себестоимость одного вызова по фактическому usage (та же формула, что usage-report/кап). */
export function usageToUsd(u: ChatUsage): number {
  const p = price()
  const cr = u.cache_read_input_tokens ?? 0
  const cw1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const cw5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0
  const cwLegacy = (u.cache_creation_input_tokens ?? 0) - cw1 - cw5
  const write = cw1 * p.inUsd * 2 + cw5 * p.inUsd * 1.25 + Math.max(0, cwLegacy) * p.inUsd * 1.25
  return ((u.input_tokens ?? 0) * p.inUsd + cr * p.inUsd * 0.1 + write + (u.output_tokens ?? 0) * p.outUsd) / 1e6
}

/**
 * Оценка «≈ N ед.» до отправки. Считаем токены точно (count_tokens — бесплатно),
 * а режим кэша — по положению в диалоге: первый ход пишет всё в кэш (2×),
 * следующие читают систему и историю из кэша (0.1×) и пишут только хвост.
 */
/**
 * Себестоимость сообщения из токенов промпта — ОДНА формула для оценки и для
 * объяснения в интерфейсе. warm: система и история уже в кэше (читаем 0.1×,
 * пишем только хвост). cold: кэш протух (>1 ч без сообщений) или контекст
 * изменился — весь промпт пишется в кэш заново (2× при TTL 1 ч). Инцидент
 * Даши 07.09: «написано 5, списали 25» — оценка считала кэш тёплым по наличию
 * истории в чате, а история у неё есть всегда, кэш после перерыва — нет.
 */
export function chatEstimateUsd(tokens: number, tailTokens: number, warm: boolean, model = MODEL): number {
  const p = MODEL_PRICES_USD[model] ?? price()
  const tail = Math.min(tokens, Math.max(0, tailTokens))
  const inputUsd = warm
    ? (tokens - tail) * p.inUsd * 0.1 + tail * p.inUsd * 2   // кэш + свежий хвост (пишется в кэш)
    : tokens * p.inUsd * 2                                    // всё пишется в кэш заново
  return (inputUsd + CHAT_ESTIMATE_OUTPUT_TOKENS * p.outUsd) / 1e6
}

/** Ключ стабильной части промпта — по нему узнаём, тёплый ли кэш у ЭТОГО контекста. */
export function contextKeyOf(systemBlocks: { text: string }[] | string[]): string {
  const text = systemBlocks.map(b => (typeof b === 'string' ? b : b.text)).join('\n\u0000')
  return createHash('sha1').update(text).digest('hex').slice(0, 24)
}

// Кэш Anthropic живёт 1 ч от СТАРТА последнего запроса с этим префиксом (чтение
// продлевает). Метку времени берём из ленты списаний (пишется после ответа) —
// запас 5 минут на длинную генерацию.
export const CACHE_WARM_WINDOW_MS = 55 * 60 * 1000

export async function isContextWarm(contextKey: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient()
      .from('unit_ledger')
      .select('id')
      .contains('meta', { contextKey })
      .gte('created_at', new Date(Date.now() - CACHE_WARM_WINDOW_MS).toISOString())
      .limit(1)
    return !!(data && data.length > 0)
  } catch { return false }
}

/** Себестоимость проверочного прохода: чтение префикса + черновик входом + исправленный выход. */
export function factcheckEstimateUsd(tokens: number, model = MODEL): number {
  const p = MODEL_PRICES_USD[model] ?? price()
  return (tokens * p.inUsd * 0.1 + CHAT_ESTIMATE_OUTPUT_TOKENS * p.inUsd + CHAT_ESTIMATE_OUTPUT_TOKENS * p.outUsd) / 1e6
}

export async function estimateChatUnits(
  systemBlocks: SystemBlock[],
  messages: ApiMessage[],
  opts: { warm?: boolean; factcheck?: boolean } = {},
): Promise<{ units: number; usd: number; tokens: number; warm: boolean; coldUnits: number; warmUnits: number }> {
  const p = price()
  let tokens = 0
  try {
    const res = await anthropic.messages.countTokens({
      model: MODEL,
      system: systemBlocks.map(b => ({ type: 'text' as const, text: b.text })),
      messages: messages as Parameters<typeof anthropic.messages.countTokens>[0]['messages'],
    })
    tokens = res.input_tokens
  } catch {
    // count_tokens недоступен — грубая оценка по символам (кириллица ≈ 1 токен на 2.5 символа)
    const chars = systemBlocks.reduce((s, b) => s + b.text.length, 0)
      + messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0)
    tokens = Math.round(chars / 2.5)
  }
  // Хвост = последнее сообщение + предыдущий ответ (они ещё не в кэше).
  const tailOf = (m?: ApiMessage) => (typeof m?.content === 'string' ? m.content.length : JSON.stringify(m?.content ?? '').length)
  const newTail = Math.min(tokens, Math.round((tailOf(messages[messages.length - 1]) + tailOf(messages[messages.length - 2])) / 2.5) + 400)
  const warm = opts.warm === true
  // Проверочный проход (07.09): префикс читается из кэша (0.1×), черновик
  // уходит входом, исправленный текст — выходом того же размера.
  const factcheckUsd = opts.factcheck ? factcheckEstimateUsd(tokens) : 0
  const coldUsd = chatEstimateUsd(tokens, newTail, false) + factcheckUsd
  const warmUsd = chatEstimateUsd(tokens, newTail, true) + factcheckUsd
  const usd = warm ? warmUsd : coldUsd
  void p
  return { units: unitsForUsd(usd), usd, tokens, warm, coldUnits: unitsForUsd(coldUsd), warmUnits: unitsForUsd(warmUsd) }
}

/**
 * Списание по факту: сумма usage всех раундов ответа → единицы шагом 0,5 →
 * половинки через consume_micro_action(p_batch=2) (каждая вторая закрывает
 * единицу), строка в ленте с фактическими единицами. minUnits — уже списанная
 * вперёд фиксированная цена (генерация «пост = 2 ед.»): доплачиваем только
 * превышение. Возвращает списанные единицы.
 */
export async function chargeChatByUsage(
  userId: string,
  usages: ChatUsage[],
  opts: { action?: string; minUnitsAlreadyCharged?: number; meta?: Record<string, unknown> } = {},
): Promise<{ units: number; usd: number }> {
  const usd = usages.reduce((s, u) => s + usageToUsd(u), 0)
  const actual = unitsForUsd(usd)
  const already = opts.minUnitsAlreadyCharged ?? 0
  const toCharge = Math.max(0, actual - already)
  if (toCharge <= 0) return { units: 0, usd }
  const admin = createAdminClient()
  const halves = Math.round(toCharge * 2)
  for (let i = 0; i < halves; i++) {
    try {
      const { data, error } = await admin.rpc('consume_micro_action', { p_user_id: userId, p_batch: UNIT_COSTS.chat_batch })
      if (error || data === false) break // лимит в нуле — остаток не долг, следующий запрос заблокирует гейт
    } catch { break }
  }
  await recordUnits(userId, opts.action ?? 'chat', toCharge, { ...(opts.meta ?? {}), usd: Math.round(usd * 1000) / 1000, rounds: usages.length })
  return { units: toCharge, usd }
}
