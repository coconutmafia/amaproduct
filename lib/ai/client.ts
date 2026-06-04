import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const MODEL = 'claude-sonnet-4-6'
export const MODEL_OPUS = 'claude-opus-4-6'
// Fast/cheap model — used for web search research (Haiku does web search in
// ~7s vs ~80s+ on Sonnet) and other light tasks.
export const MODEL_HAIKU = 'claude-haiku-4-5'
