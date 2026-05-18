import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse }       from 'next/server'

// Force dynamic — prevents Next.js from importing this module at build time
// (OpenAI key is only available at runtime, not during static analysis)
export const dynamic    = 'force-dynamic'
export const maxDuration = 300

const MIME_MAP: Record<string, string> = {
  mp3:  'audio/mpeg',  mp4:  'audio/mp4',   m4a:  'audio/x-m4a',
  wav:  'audio/wav',   ogg:  'audio/ogg',   oga:  'audio/ogg',
  opus: 'audio/ogg',   webm: 'audio/webm',  aac:  'audio/aac',
  flac: 'audio/flac',
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })

  // Dynamic import — avoids module-level SDK initialisation at build time
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Parse JSON body ────────────────────────────────────────────────────────
  // Client uploads the file directly to Supabase Storage (bypassing Vercel's
  // body-size limit), then calls this route with just the storage path +
  // optional byte range so we can chunk large files for Whisper's 25 MB cap.
  let body: { storagePath?: string; start?: number; end?: number; ext?: string; isLastChunk?: boolean }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { storagePath, start, end, ext: rawExt, isLastChunk } = body
  if (!storagePath) return NextResponse.json({ error: 'storagePath обязателен' }, { status: 400 })

  // Security: only allow access to the authenticated user's own folder
  if (!storagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const ext  = rawExt ?? storagePath.split('.').pop()?.toLowerCase() ?? 'mp3'
  const mime = MIME_MAP[ext] ?? 'audio/mpeg'

  // ── Fetch byte-range from Supabase Storage ─────────────────────────────────
  const admin = createAdminClient()
  const { data: signData, error: signError } = await admin.storage
    .from('audio-temp')
    .createSignedUrl(storagePath, 300) // 5-min TTL

  if (signError || !signData?.signedUrl) {
    console.error('Storage sign error:', signError)
    return NextResponse.json({ error: 'Не удалось получить доступ к файлу в хранилище' }, { status: 500 })
  }

  const rangeHeaders: Record<string, string> = {}
  if (start !== undefined && end !== undefined) {
    rangeHeaders['Range'] = `bytes=${start}-${end - 1}`
  }

  const storageRes = await fetch(signData.signedUrl, { headers: rangeHeaders })
  // 200 = full file, 206 = partial (Range request honoured)
  if (!storageRes.ok && storageRes.status !== 206) {
    return NextResponse.json(
      { error: `Ошибка загрузки из хранилища: ${storageRes.status}` },
      { status: 500 },
    )
  }

  const chunkBlob = await storageRes.blob()

  if (chunkBlob.size === 0) {
    return NextResponse.json({ error: 'Пустой фрагмент файла' }, { status: 400 })
  }

  const MAX = 25 * 1024 * 1024 // Whisper hard limit
  if (chunkBlob.size > MAX) {
    return NextResponse.json(
      { error: 'Фрагмент слишком большой (максимум 25 МБ). Уменьши CHUNK_BYTES на клиенте.' },
      { status: 400 },
    )
  }

  // ── Send to Whisper ────────────────────────────────────────────────────────
  const { toFile } = await import('openai')
  const audio = await toFile(chunkBlob, `interview.${ext}`, { type: mime })

  try {
    const transcription = await openai.audio.transcriptions.create({
      file:            audio,
      model:           'whisper-1',
      language:        'ru',
      response_format: 'text',
    })
    // Clean up the storage file once the last chunk is transcribed
    if (isLastChunk) {
      await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
    }

    return NextResponse.json({ text: transcription })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed'
    console.error('Whisper error:', msg)
    return NextResponse.json({ error: `Ошибка расшифровки: ${msg}` }, { status: 500 })
  }
}
