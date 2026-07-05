import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse }       from 'next/server'
import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { rateLimit } from '@/lib/rateLimit'

// ffmpeg needs the Node runtime + the binary (traced in next.config).
export const runtime     = 'nodejs'
export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Cut a TIME window with ffmpeg and re-encode to a small mono mp3. Time-splitting
// (not byte-range slicing) is the fix: a byte slice of a container format like
// m4a/mp4/ogg isn't a valid file, so Whisper rejected every chunk past the first.
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('ffmpeg-static') as string
    execFile(bin, args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`ffmpeg: ${err.message.slice(0, 200)}`))
      else resolve()
    })
  })
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  // Client uploads the file to Storage, then calls this route per TIME chunk
  // (startSec/durSec) so each Whisper call stays under the 25 MB / 300 s limits.
  let body: { storagePath?: string; startSec?: number; durSec?: number; ext?: string; isLastChunk?: boolean }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { storagePath, startSec, durSec, ext: rawExt, isLastChunk } = body
  if (!storagePath) return NextResponse.json({ error: 'storagePath обязателен' }, { status: 400 })
  if (!storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const ext = ((rawExt ?? storagePath.split('.').pop() ?? 'mp3').toLowerCase()).replace(/[^a-z0-9]/g, '') || 'mp3'

  const admin = createAdminClient()
  const { data: signData, error: signError } = await admin.storage
    .from('audio-temp')
    .createSignedUrl(storagePath, 300)
  if (signError || !signData?.signedUrl) {
    console.error('Storage sign error:', signError)
    return NextResponse.json({ error: 'Не удалось получить доступ к файлу в хранилище' }, { status: 500 })
  }

  const tmp     = `/tmp/tr-${Date.now()}`
  const inPath  = `${tmp}-in.${ext}`
  const outPath = `${tmp}-seg.mp3`
  const cleanup = () => Promise.allSettled([unlink(inPath), unlink(outPath)])

  try {
    const dl = await fetch(signData.signedUrl)
    if (!dl.ok) return NextResponse.json({ error: `Ошибка загрузки из хранилища: ${dl.status}` }, { status: 500 })
    await writeFile(inPath, Buffer.from(await dl.arrayBuffer()))

    const args = ['-y']
    if (typeof startSec === 'number' && startSec > 0) args.push('-ss', String(startSec))
    args.push('-i', inPath)
    if (typeof durSec === 'number' && durSec > 0) args.push('-t', String(durSec))
    args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', outPath)
    await runFfmpeg(args)

    const seg = await readFile(outPath)
    // A cut starting at/after the end of the file yields an empty segment. That
    // is NOT an error — it means the whole file is already transcribed. Signal
    // `ended` so the client can stop cleanly even when it never knew the duration
    // (iOS Safari often can't read it). Only an empty FIRST chunk is a real fail.
    if (seg.length < 1024) {
      if ((startSec ?? 0) > 0) {
        if (isLastChunk) await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
        return NextResponse.json({ text: '', ended: true })
      }
      return NextResponse.json({ error: 'Пустой файл — возможно, он не докачался из iCloud. Открой его в «Файлах» и попробуй снова.' }, { status: 400 })
    }
    if (seg.length > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Фрагмент слишком большой — уменьши длительность куска' }, { status: 400 })
    }

    const { default: OpenAI, toFile } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const audio = await toFile(seg, 'segment.mp3', { type: 'audio/mpeg' })
    const transcription = await openai.audio.transcriptions.create({
      file:            audio,
      model:           'whisper-1',
      language:        'ru',
      response_format: 'text',
    })

    if (isLastChunk) await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
    return NextResponse.json({ text: transcription })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed'
    console.error('Transcribe error:', msg)
    return NextResponse.json({ error: `Ошибка расшифровки: ${msg}` }, { status: 500 })
  } finally {
    await cleanup()
  }
}
