import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { NextResponse } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Short voice-clip transcription for in-app dictation. Unlike /api/ai/transcribe
// (large interview files via storage chunking), this takes a small blob directly
// — a dictation clip is a few seconds, well under Vercel's body limit. Works in
// any browser/webview with MediaRecorder, unlike the flaky Web Speech API.
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI key not configured' }, { status: 500 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let form: FormData
  try { form = await request.formData() } catch { return NextResponse.json({ error: 'Bad form data' }, { status: 400 }) }

  const file = form.get('audio') as File | null
  if (!file || file.size === 0) return NextResponse.json({ error: 'Пустая запись' }, { status: 400 })
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Запись слишком длинная' }, { status: 400 })

  try {
    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const { toFile } = await import('openai')

    // Browsers record webm/mp4/ogg — give Whisper a sane extension/type
    const type = file.type || 'audio/webm'
    const ext  = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'
    const audio = await toFile(file, `voice.${ext}`, { type })

    const text = await openai.audio.transcriptions.create({
      file:            audio,
      model:           'whisper-1',
      language:        'ru',
      response_format: 'text',
    })

    return NextResponse.json({ text: (text as unknown as string).trim() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка расшифровки'
    console.error('[transcribe-voice]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
