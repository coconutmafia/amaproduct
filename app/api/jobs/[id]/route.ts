import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureMessage, captureException } from '@/lib/sentry'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'
import { processInstagramScrapeJob } from '@/lib/jobs/runInstagramScrapeJob'
import { processBlogAuditJob } from '@/lib/jobs/runBlogAuditJob'
import { processStandaloneBlogAuditJob } from '@/lib/jobs/runStandaloneBlogAuditJob'
import { processViralReelJob } from '@/lib/jobs/runViralReelJob'
import { processMontageJob } from '@/lib/jobs/runMontageJob'
import { processVideoOverlayJob } from '@/lib/jobs/runVideoOverlayJob'
import { processResearchTableJob } from '@/lib/jobs/runResearchTableJob'
import { processWarmupPlanJob } from '@/lib/jobs/runWarmupPlanJob'
import { processWeekBriefJob } from '@/lib/jobs/runWeekBriefJob'
import { processAutofillJob } from '@/lib/jobs/runAutofillJob'
import { processCompetitorAnalysisJob } from '@/lib/jobs/runCompetitorAnalysisJob'
import { stuckJobMessage, settleStuckJob } from '@/lib/jobs/failStuckJob'

// Джобы обрабатываются в after()-инвокациях с maxDuration=300s. Если инвокация
// потерялась (деплой в момент передачи ноги, убитый воркер, несработавший
// after()), джоб застревает в processing НАВСЕГДА — а клиент вечно поллит
// «Часть 3/8» без ошибки. Порог 10 минут = 2× maxDuration: живой раннер
// обновляет progress (и триггер бампает updated_at) минимум раз в пару минут,
// а мёртвый гарантированно не воскреснет — перезапуск безопасен от гонок.
const STALE_MS = 10 * 60 * 1000
const MAX_RESTARTS = 2

export const runtime = 'nodejs'
export const maxDuration = 300

const RUNNERS: Record<string, (jobId: string) => Promise<void>> = {
  transcribe:            processTranscribeJob,        // резюмится с doneChunks
  instagram_scrape:      processInstagramScrapeJob,   // one-shot, перезапуск с нуля
  blog_audit:            processBlogAuditJob,
  blog_audit_standalone: processStandaloneBlogAuditJob,
  viral_reel:            processViralReelJob,
  montage:               processMontageJob,
  video_overlay:         processVideoOverlayJob,
  // Найдено 24.08 (вечер): research_table1 не был в этой карте — потерянная
  // инвокация уходила в error вместо рестарта, хотя раннер резюмится с
  // progress.doneBatches. Каждый новый тип джоба ОБЯЗАН попадать сюда
  // (страж: mobile-background-jobs.test.ts).
  research_table1:       processResearchTableJob,     // резюмится с doneBatches
  warmup_plan:           processWarmupPlanJob,        // one-shot
  week_brief:            processWeekBriefJob,         // one-shot
  project_autofill:      processAutofillJob,          // one-shot
  competitor_analysis:   processCompetitorAnalysisJob, // one-shot
}

// GET /api/jobs/[id] — poll a background job's status/progress/result. RLS
// (jobs_owner_select, migration 024) enforces ownership at the DB level; the
// session client is used deliberately so that guarantee is actually exercised.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, type, status, progress, result, error, created_at, updated_at')
    .eq('id', id)
    .single()
  if (error || !job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── Самолечение застрявшего джоба ──────────────────────────────────────────
  const stalled =
    (job.status === 'processing' || job.status === 'queued') &&
    Date.now() - new Date(job.updated_at as string).getTime() > STALE_MS
  if (stalled) {
    const admin = createAdminClient()
    const progress = (job.progress ?? {}) as Record<string, unknown>
    const restarts = typeof progress.restarts === 'number' ? progress.restarts : 0
    const runner = RUNNERS[job.type as string]

    if (!runner || restarts >= MAX_RESTARTS) {
      // Лечение не помогло (или тип неизвестен) — честная ошибка вместо
      // вечного «обрабатывается». Сырой контекст — в Sentry/error_events.
      const message = stuckJobMessage(job.type as string)
      const { data: marked } = await admin
        .from('jobs')
        .update({ status: 'error', error: message })
        .eq('id', id)
        .eq('updated_at', job.updated_at as string) // только один из параллельных поллеров
        .select('id, type, user_id, payload')
      if (marked && marked.length > 0) {
        // Тип-специфика: монтажу вернуть юниты и подчистить исходник и т.п.
        await settleStuckJob(admin, marked[0] as { id: string; type: string; user_id?: string | null; payload?: Record<string, unknown> | null })
        await captureException(new Error(`job stuck: ${job.type} — рестарты исчерпаны (${restarts})`), {
          where: 'jobs/[id] self-heal', jobId: id, type: job.type as string,
        })
        job.status = 'error'
        job.error = message
      }
    } else {
      // Оптимистическая блокировка по updated_at: из N параллельных поллеров
      // перезапускает только тот, чей апдейт прошёл. Для transcribe перезапуск
      // = продолжение с doneChunks; one-shot раннеры начинают заново (мёртвый
      // предшественник гарантированно ничего не дописал — см. порог выше).
      const { data: won } = await admin
        .from('jobs')
        .update({ progress: { ...progress, restarts: restarts + 1 } })
        .eq('id', id)
        .eq('updated_at', job.updated_at as string)
        .select('id')
      if (won && won.length > 0) {
        await captureMessage(
          `job self-heal: перезапуск ${job.type} после ${Math.round((Date.now() - new Date(job.updated_at as string).getTime()) / 60000)} мин простоя (рестарт ${restarts + 1}/${MAX_RESTARTS})`,
          'warning',
          { jobId: id, type: job.type as string },
        )
        after(() => runner(id))
      }
    }
  }

  return NextResponse.json({ job })
}
