import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared ffmpeg-cut + Whisper-call logic, used by BOTH the legacy per-chunk
// /api/ai/transcribe route (client-orchestrated, kept for compatibility) and
// the background job runner (lib/jobs/runTranscribeJob.ts). Time-splitting
// (not byte-range slicing) is the July-1 fix: a byte slice of a container
// format like m4a/mp4/ogg isn't a valid file, so Whisper rejected every chunk
// past the first.
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bin = require('ffmpeg-static') as string | null
    if (!bin) { reject(new Error('ffmpeg binary unavailable on this platform')); return }
    const child = execFile(bin, args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) reject(new Error(`ffmpeg: ${err.message.slice(0, 200)}`))
      else resolve()
    })
    child.on('error', (e) => reject(e))
  })
}

export interface TranscribeWindowResult {
  text?: string
  ended?: boolean   // reached the end of an unknown-length file — stop, not an error
  error?: string
  status?: number
}

export async function transcribeWindow(opts: {
  admin: SupabaseClient
  storagePath: string
  startSec: number
  durSec: number
  ext: string
  apiKey: string
}): Promise<TranscribeWindowResult> {
  const { admin, storagePath, startSec, durSec, ext, apiKey } = opts

  const { data: signData, error: signError } = await admin.storage
    .from('audio-temp')
    .createSignedUrl(storagePath, 300)
  if (signError || !signData?.signedUrl) {
    return { error: 'Не удалось получить доступ к файлу в хранилище', status: 500 }
  }

  const tmp     = `/tmp/tr-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const inPath  = `${tmp}-in.${ext}`
  const outPath = `${tmp}-seg.mp3`
  const cleanup = () => Promise.allSettled([unlink(inPath), unlink(outPath)])

  try {
    const dl = await fetch(signData.signedUrl)
    if (!dl.ok) return { error: `Ошибка загрузки из хранилища: ${dl.status}`, status: 500 }
    await writeFile(inPath, Buffer.from(await dl.arrayBuffer()))

    const args = ['-y']
    if (startSec > 0) args.push('-ss', String(startSec))
    args.push('-i', inPath)
    if (durSec > 0) args.push('-t', String(durSec))
    args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', outPath)
    await runFfmpeg(args)

    const seg = await readFile(outPath)
    // A cut starting at/after the end of the file yields an empty segment —
    // NOT an error, it means the file already ended (only meaningful once
    // we've moved past the first window; an empty FIRST chunk is a real fail).
    if (seg.length < 1024) {
      if (startSec > 0) return { ended: true, text: '' }
      return { error: 'Пустой файл — возможно, он не докачался из iCloud. Открой его в «Файлах» и попробуй снова.', status: 400 }
    }
    if (seg.length > 25 * 1024 * 1024) {
      return { error: 'Фрагмент слишком большой — уменьши длительность куска', status: 400 }
    }

    const { default: OpenAI, toFile } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const audio = await toFile(seg, 'segment.mp3', { type: 'audio/mpeg' })
    const transcription = await openai.audio.transcriptions.create({
      file: audio, model: 'whisper-1', language: 'ru', response_format: 'text',
    })
    return { text: transcription as unknown as string }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed'
    return { error: `Ошибка расшифровки: ${msg}`, status: 500 }
  } finally {
    await cleanup()
  }
}
