import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcribeWindow } from '@/lib/jobs/transcribeWindow'
import { sanitizeTranscribeError } from '@/lib/jobs/transcribeErrors'
import { captureException } from '@/lib/sentry'
import { embedMaterialChunks } from '@/lib/ai/embed'
import { fmtDateRu } from '@/lib/dates'
import { refundGenerations } from '@/lib/generations'
import { transcribeUnits } from '@/lib/generations-config'
import { setUsageUser } from '@/lib/ai/usageContext'

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
  payload: { storagePath: string; ext: string; durationSec?: number | null; saveTranscriptMaterial?: boolean; unitsRefunded?: boolean; unitsCharged?: number; language?: string }
  progress: { doneChunks?: number; totalChunks?: number | null }
  result: { text?: string; materialId?: string | null } | null
}

// Минимум текста, ради которого стоит сохранять ЧАСТИЧНУЮ расшифровку при
// обрыве (≈ полминуты речи). Меньше — скорее шум/обрывок, чем ценность.
const PARTIAL_SAVE_MIN_CHARS = 400

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

  setUsageUser(row.user_id ?? undefined) // чей расход — для журнала ai_usage
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
    const res = await transcribeWindow({ admin, storagePath, startSec, durSec: CHUNK_SEC, ext, apiKey, language: row.payload.language })
    if (res.error) {
      // Обрыв на части ci из totalChunks. Уроки 31 июля:
      //   1) уже расшифрованный текст — ЦЕННОСТЬ КЛИЕНТА, его нельзя выбрасывать
      //      из-за падения следующего шага → сохраняем частичный материал;
      //   2) при ВРЕМЕННОЙ причине (кредиты/перегруз/сеть) файл в хранилище
      //      оставляем — «Повторить» продолжит с этого же места (retry-роут),
      //      вместо «переливай 100 МБ с телефона заново»;
      //   3) в jobs.error — только честный русский текст; сырец — в Sentry.
      const sanitized = sanitizeTranscribeError(res.error)

      let partialMaterialId: string | null = row.result?.materialId ?? null
      if (row.payload.saveTranscriptMaterial && row.project_id && text.trim().length >= PARTIAL_SAVE_MIN_CHARS) {
        try {
          if (partialMaterialId) {
            await admin.from('project_materials')
              .update({ raw_content: text, processing_status: 'ready' })
              .eq('id', partialMaterialId)
          } else {
            const { data: mat } = await admin.from('project_materials').insert({
              project_id:        row.project_id,
              title:             `Расшифровка интервью (неполная — оборвалась) · ${fmtDateRu(Date.now(), { day: 'numeric', month: 'long' })}`,
              material_type:     'interview_transcript',
              raw_content:       text,
              processing_status: 'ready',
            }).select('id').single()
            partialMaterialId = (mat?.id as string) ?? null
          }
        } catch (e) {
          await captureException(e, { where: 'runTranscribeJob partial-save', jobId })
        }
      }

      if (!sanitized.retryable) {
        await admin.storage.from('audio-temp').remove([storagePath]).catch(() => {})
        // Непоправимая ошибка (битый файл и т.п.) — расшифровки не будет,
        // вернуть списанные на POST юниты. Маркер в payload защищает от второго
        // возврата (чистка 48ч возвращает только брошенные ретраебельные).
        await refundGenerations(row.user_id, row.payload.unitsCharged ?? transcribeUnits(row.payload.durationSec)).catch(() => {})
      }

      const parts: string[] = [sanitized.userMessage]
      if (partialMaterialId) parts.push('Расшифрованная часть уже сохранена в материалы проекта — она не потеряется.')
      if (sanitized.retryable) parts.push('Нажми «Повторить» — продолжу с места обрыва, заново загружать файл не нужно.')
      if (!sanitized.retryable) parts.push('Единицы контента за эту расшифровку возвращены.')

      await admin.from('jobs').update({
        status: 'error',
        error: parts.join(' '),
        payload: { ...row.payload, ...(sanitized.retryable ? {} : { unitsRefunded: true }) },
        result: { text, materialId: partialMaterialId, retryable: sanitized.retryable },
      }).eq('id', jobId)
      await captureException(new Error(res.error), { where: 'runTranscribeJob', jobId, storagePath, doneChunks: ci })
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

  // Расшифровка — в материалы СРАЗУ по готовности (флаг ставит страница
  // исследования; голосовые заметки и др. потоки не затронуты). Урок 31 июля:
  // у клиентки упал СЛЕДУЮЩИЙ шаг (таблица, окно без кредитов у провайдера),
  // она ушла с экрана — и часовая расшифровка пропала вовсе. Текст клиента
  // не должен зависеть от успеха следующего шага. save-шаг research-analyze
  // получает materialId и не создаёт дубль.
  let materialId: string | null = null
  if (row.payload.saveTranscriptMaterial && row.project_id && text.trim()) {
    try {
      // После «Повторить» частичный материал уже существует (сохранён в ветке
      // ошибки) — обновляем его до полного текста, а не плодим дубль.
      const priorId = row.result?.materialId ?? null
      if (priorId) {
        await admin.from('project_materials')
          .update({
            title:             `Расшифровка интервью · ${fmtDateRu(Date.now(), { day: 'numeric', month: 'long' })}`,
            raw_content:       text,
            processing_status: 'ready',
          })
          .eq('id', priorId)
        materialId = priorId
      } else {
        const { data: mat } = await admin.from('project_materials').insert({
          project_id:        row.project_id,
          title:             `Расшифровка интервью · ${fmtDateRu(Date.now(), { day: 'numeric', month: 'long' })}`,
          material_type:     'interview_transcript',
          raw_content:       text,
          processing_status: 'ready',
        }).select('id').single()
        materialId = (mat?.id as string) ?? null
      }
      // Эмбеддинг не критичен для сохранности текста: упал (например, OpenAI
      // без кредитов — ровно утро 31 июля) — материал всё равно сохранён.
      if (materialId) {
        try { await embedMaterialChunks(materialId, row.project_id, text) }
        catch (e) { await captureException(e, { where: 'runTranscribeJob embed', jobId }) }
      }
    } catch (e) {
      await captureException(e, { where: 'runTranscribeJob save-material', jobId })
    }
  }

  await admin.from('jobs').update({
    status: 'done',
    result: { text, materialId },
    progress: { doneChunks: ci, totalChunks: known ? totalChunks : ci },
  }).eq('id', jobId)
}
