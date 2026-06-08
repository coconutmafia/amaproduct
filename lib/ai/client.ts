import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Primary content model = the strongest available (Opus 4.8). Quality of the
// published content IS the product's value, so the flagship generation runs on
// the frontier model. Cost is offset by prompt caching (see buildCachedSystem)
// and managed via plan limits.
export const MODEL = 'claude-opus-4-8'
export const MODEL_OPUS = 'claude-opus-4-8'
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
