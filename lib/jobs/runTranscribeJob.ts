import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcribeWindow } from '@/lib/jobs/transcribeWindow'
import { captureException } from '@/lib/sentry'

const CHUNK_SEC = 600     // 10-min windows — matches the client's prior chunking
const MAX_CHUNKS = 48     // safety cap ≈ 8h, same as before
// Leave real margin under maxDuration=300s for network/ffmpeg/Whisper latency
// on the LAST chunk of this invocation, plus the final cleanup/DB write.
const TIME_BUDGET_MS = 220_000

interface JobRow {
  id: string
  user_id: string
  project_id: string | null
  status: string
  payload: { storagePath: string; ext: string; durationSec?: number | null }
  progress: { doneChunks?: number; totalChunks?: number | null }
  result: { text?: string } | null
}

function continueUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? (process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}`)
    : 'http://localhost:3000'
  return `${base}/api/jobs/continue`
}

// Runs one "leg" of a transcription job: processes chunks until either the
// file is fully transcribed, an error occurs, or this invocation's time
// budget is exhausted — in which case it schedules its own continuation via
// a self-fetch wrapped in `after()` (guaranteed to be sent even though this
// invocation is about to end) and returns. Idempotent: re-entering a
// done/error job is a no-op, so a duplicate continuation call can't corrupt
// state or double-charge Whisper.
export async function processTranscribeJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // already finished

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    await admin.from('jobs').update({ status: 'error', error: 'OpenAI API key not configured' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  const { storagePath, ext, durationSec } = row.payload
  const known = typeof durationSec === 'number' && durationSec > 0
  const totalChunks = known ? Math.max(1, Math.ceil((durationSec as number) / CHUNK_SEC)) : MAX_CHUNKS

  let ci = row.progress?.doneChunks ?? 0
  let text = row.result?.text ?? ''
  const startedAt = Date.now()

  while (ci < totalChunks) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Out of time this leg — persist progress and hand off to a fresh invocation.
      await admin.from('jobs').update({
        progress: { doneChunks: ci, totalChunks: known ? totalChunks : null },
        result: { text },
      }).eq('id', jobId)
      after(async () => {
        try {
          await fetch(continueUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET ?? ''}` },
            body: JSON.stringify({ jobId }),
          })
        } catch (e) {
          await captureException(e, { where: 'runTranscribeJob continue-fetch', jobId })
        }
      })
      return
    }

    const startSec = ci * CHUNK_SEC
    const res = await transcribeWindow({ admin, storagePath, startSec, durSec: CHUNK_SEC, ext, apiKey })
    if (res.error) {
      await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
      await admin.from('jobs').update({ status: 'error', error: res.error }).eq('id', jobId)
      await captureException(new Error(res.error), { where: 'runTranscribeJob', jobId, storagePath })
      return
    }
    if (res.ended) { ci = totalChunks; break } // reached the true end of an unknown-length file
    if (res.text) text += (text ? ' ' : '') + res.text
    ci++
    await admin.from('jobs').update({
      progress: { doneChunks: ci, totalChunks: known ? totalChunks : null },
      result: { text },
    }).eq('id', jobId)
  }

  await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
  await admin.from('jobs').update({
    status: 'done',
    result: { text },
    progress: { doneChunks: ci, totalChunks: known ? totalChunks : ci },
  }).eq('id', jobId)
}
