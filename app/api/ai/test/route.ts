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

    // Minimal API call. 200 токенов, не 10: у opus-5 размышление включено —
    // крошечный потолок съедался им целиком и text выходил пустым.
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Say: ok' }],
    })

    const tb = response.content.find(b => b.type === 'text')
    const text = tb && tb.type === 'text' ? tb.text : ''
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
