import Anthropic from '@anthropic-ai/sdk'
import { logAiUsage } from '@/lib/ai/usageLog'

const raw = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ── Учёт токенов (ai_usage, 25.08) ───────────────────────────────────────────
// ВСЕ вызовы Claude в проекте идут через этот экземпляр (страж model-upgrade),
// поэтому токены логируются здесь один раз, а не в 29 местах. Роут вычисляется
// из стека вызова (короткий путь файла) — без ручной протяжки контекста.
// Fire-and-forget + fail-open: лог не добавляет латентности и не ломает вызов.
// user_id на этом уровне неизвестен — по-юзерные факты дают строки метеринга
// (jobs, gateContentUnit/gateMicroAction); джоин делает usage-report.
function callerRoute(): string {
  const stack = new Error().stack || ''
  for (const line of stack.split('\n').slice(1)) {
    const m = line.match(/(?:app|lib)[/\\][^)\s:]+/)
    if (m && !m[0].includes('lib/ai/client') && !m[0].includes('lib\\ai\\client')) {
      return m[0].replace(/\\/g, '/').replace(/\.(ts|js|mjs)$/, '').slice(0, 120)
    }
  }
  return 'unknown'
}

function logTokens(route: string, model: string, usage?: { input_tokens?: number; output_tokens?: number } | null) {
  if (!usage) return
  // Импорт СТАТИЧЕСКИЙ и в отдельный модуль без лишних зависимостей: первая
  // версия звала usage.ts динамическим import() и глушила ошибку в .catch —
  // в проде это дало ноль строк от Claude при живых строках Whisper.
  void logAiUsage({
    route, provider: 'anthropic', model,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
  })
}

// Тонкая обёртка: create() и stream() ведут себя ровно как у SDK, плюс после
// завершения отдают usage в logUsage. ВЫНЕСЕНА ОТДЕЛЬНОЙ ФУНКЦИЕЙ намеренно —
// чтобы сам механизм перехвата проверялся юнит-тестом с подставным SDK, а не
// «по факту наличия строк в проде» (первая версия обёртки молчала, и увидеть
// это можно было только в пустой таблице).
type UsageOut = { input_tokens?: number; output_tokens?: number }
export function wrapAnthropicForUsage<T extends object>(
  target: T,
  logUsage: (route: string, model: string, usage?: UsageOut | null) => void,
  routeOf: () => string = callerRoute,
): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop !== 'messages') return Reflect.get(t, prop, receiver)
      const messages = (t as { messages: Record<string, unknown> }).messages
      return new Proxy(messages, {
        get(mTarget, mProp, mReceiver) {
          // Внутри обёртки типы либеральные (create у SDK перегружен по stream);
          // СНАРУЖИ типизация не меняется — Proxy сохраняет тип клиента.
          if (mProp === 'create') {
            return (body: { model: string; stream?: boolean }, options?: unknown) => {
              const route = routeOf()
              const res = (mTarget.create as (b: unknown, o?: unknown) => Promise<unknown>)(body, options)
              // stream:true у create() отдаёт Stream без итогового usage — так в
              // проекте не вызывают (стримим через .stream()), не логируем.
              if (!body.stream) {
                Promise.resolve(res)
                  .then((msg) => logUsage(route, String(body.model), (msg as { usage?: UsageOut }).usage))
                  .catch(() => { /* ошибка вызова — логировать нечего */ })
              }
              return res
            }
          }
          if (mProp === 'stream') {
            return (body: { model: string }, options?: unknown) => {
              const route = routeOf()
              const stream = (mTarget.stream as (b: unknown, o?: unknown) => { finalMessage: () => Promise<{ usage?: UsageOut }> })(body, options)
              stream.finalMessage()
                .then((msg) => logUsage(route, String(body.model), msg.usage))
                .catch(() => { /* оборванный/упавший стрим — логировать нечего */ })
              return stream
            }
          }
          return Reflect.get(mTarget, mProp, mReceiver)
        },
      })
    },
  }) as T
}

export const anthropic = wrapAnthropicForUsage(raw, logTokens)

// Primary content model = the strongest available. Quality of the published
// content IS the product's value, so flagship generation runs on the frontier
// model. Cost is offset by prompt caching (see buildCachedSystem) + plan limits.
//
// Set via env so we can move to a new frontier model the day it ships WITHOUT a
// code change — flip ANTHROPIC_CONTENT_MODEL and redeploy (do a quick quality
// pass first: voice + forced-tool JSON can shift between models).
// 25.08.2026: opus-4-8 → opus-5 (решение Матвея). Цена та же ($5/$25 за 1М),
// стилевой A/B перед переходом: 0 нарушений анти-AI-правил из 12 генераций у
// opus-5 против 1 у 4.8, JSON-валидность 100% у обеих; из-за встроенного
// размышления ответ ~1.8× дороже по out-токенам и ~1.6× медленнее — принято
// осознанно (качество = продукт). Замер: scratchpad style-eval, 25.08.
export const MODEL = process.env.ANTHROPIC_CONTENT_MODEL || 'claude-opus-5'
// Balanced model — available for drafts / high-volume secondary tasks if we ever
// need to trade a bit of quality for margin on a specific path.
export const MODEL_SONNET = 'claude-sonnet-4-6'
// Fast/cheap model — used for web search research (Haiku does web search in
// ~7s vs ~80s+ on bigger models) and other light "plumbing" tasks the user
// never sees the quality of.
export const MODEL_HAIKU = 'claude-haiku-4-5'

// Prompt caching: wrap a large, stable system/RAG prompt so its tokens are
// billed at ~10% on repeat calls (same conversation, the auto-continue loop,
// or repeat requests for the same project). Pure margin win — identical output.
// Anthropic caching is GA in 2026; passing system as a block with cache_control
// is all that's needed.
export function buildCachedSystem(text: string) {
  return [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } }]
}

// Честный текст для главного catch AI-роутов. Правило (урок 17/31 июля):
// в ответ клиенту НИКОГДА не уходит сырой error.message — он тащит хвосты
// провайдера («credit balance», ссылки на биллинг) и внутренности; сырец
// кладётся в captureException → error_events, клиент видит это сообщение.
export const AI_BUSY_MESSAGE =
  'Генерация сейчас перегружена или временно недоступна — попробуй через минуту-две.'
