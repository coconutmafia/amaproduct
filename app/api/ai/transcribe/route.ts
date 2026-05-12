import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Force dynamic — prevents Next.js from importing this module at build time
// (OpenAI key is only available at runtime, not during static analysis)
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SUPPORTED = ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/ogg',
  'audio/webm', 'video/mp4', 'audio/x-m4a', 'audio/aac', 'application/octet-stream']

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })

  // Dynamic import — avoids module-level SDK initialisation at build time
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('audio') as File | null
  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'Файл не найден' }, { status: 400 })
  }

  const MAX = 25 * 1024 * 1024 // 25 MB — Whisper limit
  if (file.size > MAX) {
    return NextResponse.json({ error: 'Файл слишком большой (максимум 25 МБ)' }, { status: 400 })
  }

  // Normalise to a type Whisper accepts
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp3'
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg', mp4: 'audio/mp4', m4a: 'audio/x-m4a',
    wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac',
  }
  const mime = mimeMap[ext] ?? (SUPPORTED.includes(file.type) ? file.type : 'audio/mpeg')

  // Re-wrap so OpenAI SDK gets a properly-named File
  const bytes = await file.arrayBuffer()
  const audio = new File([bytes], `interview.${ext}`, { type: mime })

  try {
    const transcription = await openai.audio.transcriptions.create({
      file:            audio,
      model:           'whisper-1',
      language:        'ru',
      response_format: 'text',
    })

    return NextResponse.json({ text: transcription })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed'
    console.error('Whisper error:', msg)
    return NextResponse.json({ error: `Ошибка расшифровки: ${msg}` }, { status: 500 })
  }
}
