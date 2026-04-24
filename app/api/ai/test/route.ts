import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'

export const maxDuration = 30

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const keySet = !!process.env.ANTHROPIC_API_KEY
    const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 12) + '...' || '(not set)'

    if (!keySet) {
      return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY не задан в переменных окружения', keyPrefix })
    }

    // Minimal API call — 1 token
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say: ok' }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ ok: true, model: MODEL, response: text, keyPrefix })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // Extract Anthropic nested error
    let fullError = raw
    try {
      const jsonStart = raw.indexOf('{')
      if (jsonStart !== -1) {
        const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { type?: string; message?: string } }
        if (parsed?.error?.message) {
          fullError = `[${parsed.error.type}] ${parsed.error.message}`
        }
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: false,
      error: fullError,
      model: MODEL,
      keyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0, 12) + '...' || '(not set)',
    }, { status: 500 })
  }
}
