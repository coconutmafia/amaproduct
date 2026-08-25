import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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
